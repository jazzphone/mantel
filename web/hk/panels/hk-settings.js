// hk-settings.js -- HK SETTINGS, the admin page (panel.py), built as an
// Apple settings screen:
//
//   OVERVIEW       where settings live, setup status
//   SCREENS        each dashboard, one page: Menu, Home Page, Pages,
//                  Appearance, Behavior -- a live preview beside it
//   ALL SCREENS    General, Weather, Appearance, Sky,
//                  Menu, Rooms (and each room's page), Wall Tablets
//   FEATURES       Music, Live TV, Alarm PIN, Clean Areas
//                  (hk-settings-features.js)
//   LIBRARY        Accessories (by type, then room), Pop-ups, Custom Pages,
//                  Custom Chips
//   SYSTEM         Advanced, Setup Check (+ the Setup Assistant)
//
// A sidebar with search beside the page on a wide window; stacked pages with
// a back button on a phone. The address is the page (#/screens/dashboard-
// kitchen/chips), so Back, reload and links work.
//
// EVERY CONTROL SAVES AS IT CHANGES, as Settings does: only what changed
// goes to the integration (hk_frontend/settings/set, hk_frontend/board/set --
// settings_api.py checks it the way Configure does), and the bar says Saved
// or what went wrong, beside the field. Configure (HA's own dialogs) keeps
// working on the same storage; either can be used.
//
// Words and the small decisions (what a list shows, what a change saves)
// are hk-settings-model.js; the controls are hk-settings-kit.js.
//
// THE HOST'S SETTINGS (hkShell.settingsHost(), null on a host without any):
// a host may put its own pages beside HK's, drawn with the same kit. The page
// knows nothing of them but this shape:
//   { title       the page's name in place of "HK Settings"
//     house       false: the host's pages only (HK's own are not read)
//     groups()    [{ header, place: 'top' | 'end', rows: [{ route, label,
//                 sub, tile: [icon, color] }] }] -- sidebar groups, above
//                 Overview ('top') or after System ('end')
//     page(parts, panel)  the page for an address the host owns, or null
//     forward(path)       an old address of the host's -> where it is now
//     first()             where an empty address opens (null: Overview)
//     search()            [{ label, route, where, words }]
//     notes               { overview, screen_remove, add_screen }: the
//                 host's words where HK's own page differs on it
//     screenBase          the prefix of a screen's own address
//     back                { label, href }: the way out, on a host with no
//                 sidebar of its own
//     owns        { tablet_user: true }: what of HK's own the host keeps
//                 itself, so HK's control for it is not drawn (a wall
//                 tablet's Tablet User: the host's 'tablet' group has it)
//     extend(where, c, ctx, panel)  the host's own groups on one of HK's
//                 pages, appended to c: where 'tablets' (Wall Tablets, after
//                 its list; ctx { tablets }), 'tablet' (a wall tablet's
//                 page, after Setup; ctx { tablet, name, app }), 'screen'
//                 (a screen's page, after This Device; ctx { screen, title }),
//                 'saver' (a screen's Screensaver Options, first; ctx { screen,
//                 title }) or 'house-saver' (All Screens' Screensaver, after
//                 Photos; ctx { photos, set(source) })
//     press(ids, panel)  a tablet's own parts that are the host's, not HA
//                 buttons (Reload, Clear Cache: tablets[].parts), pressed:
//                 a promise (rejected with a message to show), or null to
//                 leave them to HA's button.press }
// Home Assistant has none, so nothing of another host's is drawn, read or
// said there.
(function () {
  'use strict';
  if (customElements.get('hk-settings-panel')) return;

  var DOMAIN = 'hk_frontend';
  var M = null, K = null, h = null, F = null;

  // the modules, fetched beside this one with its version (panel.py puts the
  // files' time on our URL)
  function stamp(panel) {
    try { var u = panel.config._panel_custom.module_url; var m = /[?&]v=(\d+)/.exec(u); if (m) return m[1]; } catch (e) { /* none */ }
    return String(Date.now());
  }
  // A BACKGROUND PHOTO, made no bigger than `max` px on its long side and
  // saved as a JPEG, before it is uploaded (photoUpload). Its pixels come
  // through a canvas, so what is stored carries no location or camera data.
  function shrinkPhoto(file, max) {
    return new Promise(function (resolve, reject) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, hh = img.naturalHeight, k = Math.min(1, max / Math.max(w, hh, 1));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(hh * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(u);
        cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error('It couldn’t be made into a JPEG.')); }, 'image/jpeg', 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(u); reject(new Error('That file isn’t a picture this browser can open.')); };
      img.src = u;
    });
  }
  // AN HTTP WRITE TO THE HOST'S API (a config flow's start, step or
  // abandon), made exactly as the frontend's own callApi makes one, but
  // through the client's action port (`request`, an authenticated fetch of a
  // path on the host): the path under /api/; a JSON body, with its type, when
  // there is one; the answer read as JSON when it says it is JSON, else as
  // text; an error answer, a body that won't parse or a request that never
  // arrived thrown as {error, status_code, body}, as callApi throws them. A
  // host that cannot act refuses (commands_disabled), sending nothing, and
  // that refusal is passed on as it is.
  function restWrite(actions, method, path, body) {
    var init = { method: method, headers: {} };
    if (body) {
      init.headers['Content-Type'] = 'application/json;charset=UTF-8';
      init.body = JSON.stringify(body);
    }
    return Promise.resolve(actions.request('/api/' + path, init)).then(function (res) {
      var type = res.headers.get('content-type');
      var read = type && type.indexOf('application/json') >= 0
        ? res.json().catch(function (e) { throw { error: 'Unable to parse JSON response', status_code: e && e.status, body: null }; })
        : res.text();
      return read.then(function (b) {
        if (!res.ok) throw { error: 'Response error: ' + res.status, status_code: res.status, body: b };
        return b;
      });
    }, function (e) {
      if (e && e.code === 'commands_disabled') throw e;
      throw { error: 'Request error', status_code: undefined, body: undefined };
    });
  }
  function ensureFont() {
    if (document.querySelector('link[data-hk-font]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/hk/fonts/sf-pro.css'; l.setAttribute('data-hk-font', '');
    document.head.appendChild(l);
  }
  // The dashboards' own modules, for an accessory's settings: the settings
  // feed they read, the glyphs, the detail sheet's pane.
  var cardsReady = null;
  function loadCards() {
    if (cardsReady) return cardsReady;
    cardsReady = (async function () {
      var v = Date.now();
      var tries = [['hkSettings', '/hk/modules/hk-settings.js'], ['customIconsets', '/hk/iconset/hk-icons.js'],
                   ['hkCards', '/hk/cards/hk-base.js'], ['hkDetail', '/hk/cards/hk-detail.js']];
      for (var i = 0; i < tries.length; i++) {
        var t = tries[i];
        if (t[0] === 'customIconsets' ? (window.customIconsets && window.customIconsets.hk) : window[t[0]]) continue;
        try { await import(t[1] + '?v=' + v); } catch (e) { console.warn('[hk-settings] ' + t[1], e); }
      }
    })();
    return cardsReady;
  }

  // ------------------------------------------------------------ the shell
  var CSS = [
    // PINNED TO THE WINDOW. Home Assistant's panel container
    // (partial-panel-resolver) has no height of its own, so height:100% grew
    // the panel to its content and the window scrolled the menu and the page
    // together. The window's height gives each its own scroll.
    ':host{height:100vh;height:100dvh}',
    // SAFE AREAS (an iPhone or iPad full screen: the web app on the Home
    // Screen, a native app's web view): the notch, the status bar and the rounded
    // corners stay out of the lists. The host keeps the window's height and
    // pads itself; the bottom (the home indicator) pads each scroller's end,
    // so rows scroll under it but the last one stops above it. env() is 0
    // everywhere else (HA's panel, a desktop browser), so nothing moves there.
    ':host{box-sizing:border-box;background:var(--hk-bg);',
    '  padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) 0 env(safe-area-inset-left,0px)}',
    '.app{display:flex;height:100%;overflow:hidden;position:relative}',
    '.side{flex:none;width:320px;height:100%;overflow-y:auto;overscroll-behavior:contain;padding:0 16px calc(40px + env(safe-area-inset-bottom,0px));',
    '  border-right:.5px solid var(--hk-sep)}',
    '.sidetop{position:sticky;top:0;z-index:2;background:var(--hk-bg);padding:10px 0 12px;margin:0 -4px;',
    '  border-bottom:.5px solid transparent;transition:border-color .2s}',
    // the list scrolled under the search: its hairline, as the top bar's
    '.side.scrolled .sidetop{border-bottom-color:var(--hk-sep)}',
    // the title on the column the search field and the lists start on (4px
    // undoes .sidetop's -4px); only with Home Assistant's ☰ in front of it
    // is the row pulled left, so the button's own padding sits in the margin
    '.sidehead{display:flex;align-items:center;gap:4px;min-height:44px;margin-left:4px}',
    '.sidehead.menubtn{margin-left:-8px}',
    '.sidehead h1{margin:0;font-family:var(--hk-display);font-size:22px;font-weight:700;letter-spacing:.01em}',
    '.search{position:relative;margin:6px 4px 0}',
    '.search input{width:100%;height:36px;border:0;border-radius:10px;padding:0 30px 0 32px;background:var(--hk-fill);',
    '  color:var(--hk-label);font:inherit;font-size:16px;outline:none}',
    '.search input::placeholder{color:var(--hk-label2)}',
    '.search input:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--hk-tint) 45%,transparent)}',
    // a block, not an inline icon on a line's baseline (which sat it 3 px low)
    '.search .mag{position:absolute;left:9px;top:9px;width:18px;height:18px;color:var(--hk-label2);--mdc-icon-size:18px;display:flex}',
    // A PICKER'S SELECT MODE (several at once): its bar under the search
    '.pickbar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:-10px 4px 12px;min-height:36px}',
    // a background photo (photoGroup): the picture at the screen's shape, and
    // what it follows under it when it isn't its own
    '.cell.photoprev{flex-direction:column;align-items:stretch;gap:6px;padding-top:12px;padding-bottom:12px}',
    '.photoprev img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:10px;background:#05070e}',
    '.photoprev small{color:var(--hk-label2);font-size:13px}',
    '.flat-image-mini{position:relative;flex:none;width:80px;height:50px;overflow:hidden;border-radius:8px;margin-right:12px;background:var(--hk-cell)}',
    '.flat-image-thumb{display:block;width:100%;height:100%;object-fit:cover}',
    '.flat-image-preview{position:relative;overflow:hidden;border-radius:10px;aspect-ratio:16/10;background:var(--hk-cell)}',
    '.flat-image-preview canvas{display:block;width:100%;height:100%;object-fit:cover}',
    '.flat-image-wash{position:absolute;inset:0;pointer-events:none}',
    '.flat-image-adjust summary{cursor:pointer;min-height:44px;border-radius:10px;background:var(--hk-cell)}',
    // LANDSCAPES (2026-10-14): the picker's grid of HK's own photos, the one
    // in use ringed and ticked
    '.cell.landcell{display:block;padding:12px}',
    '.landgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px}',
    '.landgrid button{position:relative;display:block;border:0;padding:0;border-radius:10px;overflow:hidden;cursor:pointer;background:#05070e;aspect-ratio:16/10}',
    '.landgrid img{display:block;width:100%;height:100%;object-fit:cover}',
    '.landgrid button.on{box-shadow:0 0 0 3px var(--hk-tint)}',
    '.landgrid button.on::after{content:"\\2713";position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:50%;background:var(--hk-tint);color:#fff;font-size:14px;font-weight:700;line-height:22px;text-align:center}',
    '.pickbar .pcount{flex:1;color:var(--hk-label2);font-size:15px;padding-left:4px;white-space:nowrap}',
    '.pickbar button{border:0;background:none;color:var(--hk-tint);font:inherit;font-size:15px;padding:7px 9px;border-radius:9px;cursor:pointer;white-space:nowrap}',
    '.pickbar button.add{background:var(--hk-tint);color:#fff;font-weight:600;padding:7px 14px}',
    '.pickbar button:disabled{opacity:.4;cursor:default}',
    '.pickbar button:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--hk-tint) 45%,transparent);outline:none}',
    '.side .grp{margin-bottom:22px}',
    '.side .gh{padding-left:12px}',
    '.side .cell{padding-left:12px;min-height:44px}',
    '.side .cell.hasic + .cell::before,.side .cell + .cell.hasic::before{left:54px}',
    '.side a.cell[aria-current="page"]{background:var(--hk-sel);color:#fff}',
    '.side a.cell[aria-current="page"] .val,.side a.cell[aria-current="page"] .chev,.side a.cell[aria-current="page"] small{color:rgba(255,255,255,.8)}',
    '.side a.cell[aria-current="page"]::before,.side a.cell[aria-current="page"] + .cell::before{display:none}',
    '.side a.cell[aria-current="page"] .tile{box-shadow:0 0 0 1.5px rgba(255,255,255,.55)}',
    '.side .chev{display:none}',
    ':host(:not([wide])) .side .chev{display:block}',
    '.detail{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;position:relative}',
    '.bar{flex:none;position:absolute;top:0;left:0;right:0;z-index:5;display:flex;align-items:center;gap:8px;height:52px;',
    '  padding:0 10px;background:var(--hk-bar);-webkit-backdrop-filter:blur(20px) saturate(1.8);backdrop-filter:blur(20px) saturate(1.8);',
    '  border-bottom:.5px solid transparent;transition:border-color .2s}',
    '.bar.scrolled{border-bottom-color:var(--hk-sep)}',
    '.bar .back{display:inline-flex;align-items:center;gap:3px;height:44px;max-width:100%;min-width:0;padding:0 8px 0 2px;border:0;',
    '  background:none;color:var(--hk-tint);font-size:17px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.bar .back svg{width:12px;height:20px;flex:none}',
    '.bar .back span{overflow:hidden;text-overflow:ellipsis}',
    '.bar .mid{flex:1;min-width:0;text-align:center;font-weight:600;font-size:17px;opacity:0;transition:opacity .2s;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.bar.scrolled .mid{opacity:1}',
    '.bar .st{flex:1 1 0;min-width:0;display:flex;justify-content:flex-end;align-items:center;gap:5px;font-size:13px;color:var(--hk-label2)}',
    '.bar .st.err{color:var(--hk-red)}',
    '.bar .st svg{width:13px;height:13px;color:var(--hk-green)}',
    '.bar .lead{flex:1 1 0;min-width:0;display:flex;align-items:center}',
    '.bar .mid{flex:0 1 auto;max-width:50%}',
    // the title shows in the bar only once the page scrolls (its large
    // title gone): until then it takes no room, and the back button's label
    // is not cut short beside an invisible one ("Living …", 2026-09-30)
    '.bar:not(.scrolled) .mid{max-width:0}',
    '.bar:not(.scrolled) .lead{flex:0 1 auto;max-width:calc(100% - 96px)}',
    '.scroll{flex:1;overflow-y:auto;overscroll-behavior:contain;padding-top:52px}',
    '.page{max-width:680px;margin:0 auto;padding:6px 20px calc(80px + env(safe-area-inset-bottom,0px))}',
    // 32px between the columns only: between the title and the settings the
    // subtitle's own 24px, as on every page without a preview (a 32px row
    // gap on top made it 56)
    '.page.split{max-width:1240px;display:grid;grid-template-columns:minmax(0,640px) minmax(320px,1fr);gap:0 32px;align-items:start}',
    // the preview starts where the settings start -- its PREVIEW beside the
    // first section's heading, not up beside the page's title
    '.page.split{grid-template-areas:"ph ." "pc pv"}',
    '.page.split .ph{grid-area:ph}',
    '.page.split .pc{grid-area:pc}',
    // -3px: the preview's heading sits 3px lower in its box than a group's
    // (measured), so this lines both up -- PREVIEW with the first section's
    // heading, the preview with the first group
    '.page.split .pvcol{grid-area:pv;align-self:start;position:sticky;top:64px;margin-top:-3px}',
    // no heading over the first group: PREVIEW rides above it, the box level with the group
    '.page.split.nohead .pvcol{margin-top:-28px}',
    // narrower: the preview sits under the title of the screen's own page
    ':host(:not([xwide])) .page.split{display:block;max-width:680px}',
    // ...and scrolls away with the page: sticky there, the settings scrolled
    // up under it and it lay over them (2026-10-06)
    ':host(:not([xwide])) .page.split .pvcol{margin:0 0 30px;max-width:480px;position:static}',
    '.pvcol:empty{display:none}',
    // PINNED (the bar's Preview): at the top of the page, over the settings
    // as they scroll under it; the size and moment pickers stay
    ':host .page.split .pvcol.pin,:host(:not([xwide])) .page.split .pvcol.pin{position:sticky;top:0;z-index:3;margin:0 -20px 18px;',
    '  padding:8px 20px 8px;max-width:none;background:var(--hk-bg);box-shadow:0 .5px 0 var(--hk-sep)}',
    ':host(:not([wide])) .page.split .pvcol.pin{margin:0 -16px 18px;padding:8px 16px 8px}',
    '.pvcol.pin .gf,.pvcol.pin .pvhead{display:none}',
    '.pvcol.pin .pvbox{margin:0 auto}',
    '.pvcol.pin .seg{margin-top:8px}',
    // the bar's Preview button: a pin and a word (Pin, Pinned), as a
    // navigation bar's text buttons are; filled while the preview is pinned
    '.bar .pvtoggle{flex:none;height:32px;margin-right:4px;padding:0 10px 0 7px;border:0;border-radius:16px;background:none;',
    '  color:var(--hk-tint);display:flex;align-items:center;gap:3px;cursor:pointer;font:inherit;font-size:15px;white-space:nowrap}',
    '.bar .pvtoggle hk-icon{--mdc-icon-size:18px;width:18px;height:18px;display:flex}',
    '.bar .pvtoggle[aria-pressed="true"]{background:var(--hk-fill)}',
    // A HOST'S WAY OUT (settingsHost().back), over the sidebar's name
    '.hostback{display:inline-flex;align-items:center;gap:3px;height:36px;margin:4px 0 -4px -6px;padding:0 8px 0 2px;color:var(--hk-tint);',
    '  text-decoration:none;font-size:17px}',
    '.hostback svg{width:12px;height:20px;flex:none}',
    '.code{margin:-14px 0 28px;padding:12px 16px;border-radius:10px;background:var(--hk-cell);color:var(--hk-label);',
    // YAML keeps its lines (wrapped, its indentation would lie): it scrolls
    // sideways, a size smaller on a phone so most lines fit
    '  font:13px/18px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow-x:auto;user-select:text}',
    '@media (max-width:640px){.code{font-size:12px;line-height:17px}}',
    // never wider than the page: its long lines scroll inside it
    '.code{max-width:100%;min-width:0;box-sizing:border-box}',
    'h1.lt{margin:4px 0 4px;font-family:var(--hk-display);font-size:34px;line-height:41px;font-weight:700;letter-spacing:.01em;outline:none}',
    ':host([wide]) h1.lt{font-size:30px;line-height:36px}',
    '.scope{margin:0 0 24px;font-size:15px;line-height:20px;color:var(--hk-label2)}',
    // A SCREEN'S NAME, with its pencil (renaming the dashboard): the pencil
    // beside the title, centred on its line; the field the same size as the
    // title it replaces, Save and Cancel beside it
    '.tline{display:flex;align-items:center;gap:12px;min-width:0}',
    '.tline h1.lt{min-width:0;overflow-wrap:anywhere}',
    '.ren{flex:none;width:36px;height:36px;margin-top:2px;border:0;border-radius:18px;padding:0;background:var(--hk-fill);',
    '  color:var(--hk-tint);display:flex;align-items:center;justify-content:center;cursor:pointer}',
    '.ren svg{width:17px;height:17px}',
    '.renform{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 4px}',
    '.renform input{flex:1 1 220px;min-width:0;height:44px;box-sizing:border-box;border:0;border-radius:10px;padding:0 12px;',
    '  background:var(--hk-fill);color:var(--hk-label);font-family:var(--hk-display);font-size:24px;font-weight:700;outline:none}',
    '.renform input:focus{box-shadow:0 0 0 2px var(--hk-tint)}',
    '.renform button{height:44px;padding:0 18px;border:0;border-radius:10px;font:inherit;font-size:16px;font-weight:600;cursor:pointer}',
    '.renform .ok{background:var(--hk-tint);color:#fff}',
    '.renform .ok[disabled]{opacity:.45;cursor:default}',
    '.renform .no{background:var(--hk-fill);color:var(--hk-label)}',
    '.renerr{margin:2px 0 8px;font-size:14px;line-height:18px;color:var(--hk-red)}',
    '.scope b{font-weight:600;color:var(--hk-label)}',
    '.pvbox{position:relative;width:100%;aspect-ratio:16/10;margin:0 auto;border-radius:12px;overflow:hidden;background:#000;',
    '  box-shadow:0 0 0 .5px var(--hk-sep)}',
    // the size picker under the preview: the kit's segmented control, a glyph
    // over each name. A name never wraps: when one will not fit on its line
    // (a column of about 400-470 px), every tablet drops "Tablet" together
    '.seg.pvsize{display:grid;width:100%;margin-top:12px;box-sizing:border-box}',
    '.seg.pvsize button{height:auto;min-width:0;padding:6px 2px;display:flex;flex-direction:column;align-items:center;',
    '  gap:3px;font-size:12px;line-height:14px}',
    '.seg.pvsize .lb,.seg.pvsize .sh{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.seg.pvsize .sh,.seg.pvsize.short .lb{display:none}',
    '.seg.pvsize.short .sh{display:block}',
    '.seg.pvsize hk-icon{--mdc-icon-size:20px;width:20px;height:20px;display:flex}',
    '.seg.pvsize hk-icon.rot{transform:rotate(90deg)}',
    // the sky preview's moments (Day, Night, Spooky Night), over the sizes
    '.seg.pvmoment{display:grid;width:100%;margin-top:12px;box-sizing:border-box}',
    '.seg.pvmoment button{min-width:0;padding:0 6px}',
    '.pvsky .gf{margin:8px 0 0;padding-left:4px}',
    '.pvdim{font-variant-numeric:tabular-nums}',
    '.pvbox iframe{position:absolute;top:0;left:0;width:1280px;height:800px;border:0;transform-origin:0 0;pointer-events:none}',
    '.pvhead{display:flex;align-items:baseline;justify-content:space-between;padding:0 4px 8px}',
    '.pvhead span{font-size:13px;text-transform:uppercase;color:var(--hk-label2)}',
    '.pvhead a{font-size:15px;padding:12px 4px;margin:-12px -4px}',
    '.pvcol .gf{padding-left:4px}',
    '.accwrap{--acc-cell:var(--hk-cell);--acc-sep:var(--hk-sep);--acc-label:var(--hk-label);--acc-text:var(--hk-label);',
    '  --acc-label2:var(--hk-label2);--acc-label3:var(--hk-label3);--acc-value:var(--hk-label2);--acc-fill:var(--hk-off);',
    '  --acc-seg:var(--hk-seg);--acc-seg-on:var(--hk-seg-on);--acc-glyph:var(--hk-fill);--acc-glyph-on-bg:var(--hk-tint);',
    '  --acc-glyph-on-fg:#fff;--acc-red:var(--hk-red);--acc-green:var(--hk-green);--acc-orange:var(--hk-orange);font-size:var(--hk-body)}',
    '.accwrap .acc{gap:26px}',
    '.accwrap .acc .cap{padding:0 16px 7px;font-weight:400;letter-spacing:0}',
    // (the kit's own .grp margin is not for this pane's groups: it doubled
    // every gap on an accessory's page)
    '.accwrap .acc .grp{border-radius:10px;margin:0}',
    '.accwrap .acc .row{min-height:44px}',
    '.accwrap .acc .note{padding:0 16px}',
    '.dated{display:flex;gap:6px;flex:none}',
    '.dated .pop{background:var(--hk-fill);border-radius:7px;padding:5px 10px;color:var(--hk-label)}',
    '.inl{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 16px}',
    '.inl input{flex:1 1 140px;min-width:0;height:34px;border:0;border-radius:8px;padding:0 10px;background:var(--hk-fill);color:var(--hk-label);font:inherit}',
    '.inl select{height:34px;border:0;border-radius:8px;padding:0 8px;background:var(--hk-fill);color:var(--hk-label);font:inherit;font-size:16px}',
    '.dated .pop select{inset:0;width:100%}',
    '.pbtn{height:36px;padding:0 16px;border:0;border-radius:18px;background:var(--hk-tint);color:#fff;font:inherit;font-weight:600;cursor:pointer}',
    '.pbtn:disabled{opacity:.4;cursor:default}',
    '.big{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:26px 16px 30px}',
    '.big .tile{width:64px;height:64px;border-radius:15px}',
    // the icon's own class pins 22 px: the tile's size has to be on it
    '.big .tile .ic{--mdc-icon-size:38px;color:#fff}',
    '.big h2{margin:6px 0 0;font-family:var(--hk-display);font-size:28px;font-weight:700}',
    '.big p{margin:0;max-width:44ch;color:var(--hk-label2);font-size:15px;line-height:20px}',
    '.steps{font-size:13px;color:var(--hk-label2);text-align:center;margin:0 0 8px}',
    // the kit's YAML editor is the card (.codebox)
    '.yaml{display:block}',
    'pre.ex{margin:0;padding:12px 16px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--hk-label);white-space:pre-wrap}',
    '.skycolors{display:flex;gap:8px;flex-wrap:wrap}.skycolors input[type=color]{width:44px;height:44px;padding:3px;border:1px solid var(--hk-label2);border-radius:8px;background:transparent}',
    '.ok{color:var(--hk-green)} .warn{color:var(--hk-orange)} .note{color:var(--hk-label2)}',
    // A TABLET'S DAY LEFT ALONE (Wall Tablets, 1.14): Touched -> Home ->
    // the screensaver -> dark, each where it starts
    '.cell.tl{display:block;padding:14px 16px 12px}',
    '.tl .track{display:flex;height:30px;border-radius:8px;overflow:hidden;gap:2px}',
    '.tl .seg{display:flex;align-items:center;justify-content:center;min-width:0;padding:0 6px;font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tl .use{background:#0a84ff}.tl .home{background:#30b0c7}.tl .saver{background:#bf5af2}.tl .dark{background:#636366}',
    '.tl .ticks{position:relative;height:34px;margin-top:6px;font-size:12px;line-height:16px;color:var(--hk-label2)}',
    '.tl .ticks span{position:absolute;top:0;padding-left:6px;border-left:1px solid var(--hk-sep);white-space:nowrap}',
    '.tl .ticks b{display:block;color:var(--hk-label);font-weight:600}',
    '.tl .tlwarn{margin-top:8px;color:var(--hk-orange);font-size:13px;line-height:18px}',
    '.url{font:13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;color:var(--hk-label)}',
    '.live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.loading{display:flex;align-items:center;justify-content:center;height:100%;color:var(--hk-label2)}',
    // ONE COLUMN (phones, narrow windows): the list is its own page
    ':host(:not([wide])) .side{width:100%;border-right:0;padding:0 16px calc(40px + env(safe-area-inset-bottom,0px))}',
    ':host(:not([wide])) .sidehead h1{font-size:34px;line-height:41px}',
    ':host(:not([wide])) .app[data-view="root"] .detail{display:none}',
    ':host(:not([wide])) .app[data-view="detail"] .side{display:none}',
    ':host(:not([wide])) .page{padding:6px 16px calc(80px + env(safe-area-inset-bottom,0px))}',
    // AT LEAST ONE SCREEN TALL: on a phone nothing above gives the page a
    // height, so `height:100%` would be the content's, and a short page
    // would end in a band of Home Assistant's own gray under it
    ':host(:not([wide])){min-height:100vh;min-height:100dvh}'
  ].join('\n');
  var PENCIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" stroke="currentColor" stroke-width="2"/></svg>';
  var BACK = '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var TICK = '<svg viewBox="0 0 13 13" aria-hidden="true"><path d="M2 7l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Apple's system colors for the sidebar's tiles
  // the pages that keep a tone of their own in Flat: the Glass looks'
  // own-color pages, and Calendar and Weather (hk-base.js FLAT_OWN)
  // Highlight Color Automatic's swatch: a few of the pages' colors
  var AUTO_ACCENT_TILE = 'conic-gradient(#0a84ff, #ffd60a, #40c8e0, #bf5af2, #30d158, #ff375f, #0a84ff)';
  // a page key's address (hk-strategy.js SKY_PAGE, turned around)
  var FLAT_VIEW = { music: 'playmusic', live_tv: 'live-tv', doors_windows: 'doors-windows' };
  var FLAT_OWN = { cameras: 1, live_tv: 1, security: 1, doors_windows: 1, climate: 1, lights: 1, timers: 1,
                   vacuums: 1, music: 1, water: 1, energy: 1, calendar: 1, weather: 1, power: 1 };
  // a landscape's file name (settings.py SKY_LANDSCAPE_FILE): a name, never a path
  var LAND_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(webp|jpe?g|png)$/i;
  var C = { blue: '#007aff', green: '#34c759', indigo: '#5856d6', orange: '#ff9500', pink: '#ff2d55', purple: '#af52de',
            red: '#ff3b30', teal: '#30b0c7', yellow: '#ffcc00', gray: '#8e8e93', cyan: '#32ade6', brown: '#a2845e' };
  var HOUSE = [
    // (What Counts, Status & Chips before it, is each type's page under
    // Accessories since 2026-10-13. General, Weather, Calendar, Cameras and
    // Status Rows went to Pages on 2026-10-16: their addresses forward,
    // M.routeForward)
    ['appearance', 'Appearance', 'mdi:palette', C.indigo],
    ['sky', 'Sky / Background', 'mdi:weather-night', C.purple],
    // SCREENSAVER (2026-10-13): its own entry -- what every screen's
    // screensaver shows; was Wall Tablets -> Screensaver (that address forwards)
    ['screensaver', 'Screensaver', 'mdi:image-multiple', C.pink],
    // NOW PLAYING (2026-10-15): where the music playing shows -- a side pane
    // or the bar -- on every screen that doesn't choose its own
    ['nowplaying', 'Now Playing', 'mdi:music', C.red],
    // NOTIFICATIONS (the feature's, 2026-10-16): about every screen, so here
    // rather than under Pages -- its pages keep #/features/notify/...
    ['notify', 'Notifications', 'mdi:bell-badge', C.red, null, 'features/notify'],
    ['menu', 'Menu', 'mdi:dock-left', C.orange],
    ['rooms', 'Rooms', 'mdi:sofa', C.brown],
    ['chips', 'Status Chips', 'mdi:label-multiple', C.green],
    ['tablets', 'Wall Tablets', 'mdi:tablet', C.blue]
  ];
  // Category pages with an order of their own (accessories.py PAGE_ORDERS):
  // [title, icon, what automatic is].
  var PAGE_ORDERS = { vacuums: ['Vacuums', 'mdi:robot-vacuum', 'A to Z'],
                      security: ['Security', 'mdi:lock', 'locks A to Z, then garage doors'] };
  // WHAT A PAGE'S SETTINGS PAGE SAYS UNDER ITS NAME: what else uses them,
  // where the page's settings reach beyond it (the plan's mitigation)
  var PAGE_SCOPE = {
    weather: 'The Weather page’s settings — also the header’s clock strip, the screensaver’s forecast and Climate’s Outside & Ahead.',
    calendar: 'The Calendar page’s settings — also the screensaver’s calendar pane.',
    cameras: 'The Cameras page’s settings — also every screen’s camera strip on Home that doesn’t choose its own.',
    energy: 'The Energy page, built from Home Assistant’s Energy settings: the feature, its devices and the page.',
    power: 'The Power page: the home’s battery, solar and circuits as one picture. Energy’s second page.',
    music: 'Whole-home music through Music Assistant, and the Music page’s Browse side.',
    live_tv: 'Needs an HDHomeRun tuner: its channels, live on every screen.',
    security: 'The Security page, the security system and its keypad.'
  };
  var LIBRARY = [['accessories', 'Accessories', 'mdi:lightbulb-group', C.yellow], ['popups', 'Pop-ups', 'mdi:bell-ring', C.red],
                 ['pages', 'Custom Pages', 'mdi:file-document-multiple', C.teal], ['chips', 'Custom Chips', 'mdi:label-variant', C.orange]];
  var SYSTEM = [['advanced', 'Advanced', 'mdi:cog', C.gray], ['check', 'Setup Check', 'mdi:clipboard-check', C.green]];
  // THE PRODUCT'S NAME, Home Assistant's own things and places, and the
  // documentation, as the host says them (web/client/hk-host-shell.js): HK
  // Frontend and its wiki in Home Assistant, the host's own elsewhere.
  // Labels only.
  function PN() { return window.hkShell.productName(); }
  function haName(name) { return window.hkShell.haName(name); }
  function haPlace(path) { return window.hkShell.haPlace(path); }
  // a link to a page of the documentation, opened beside these settings, or
  // null where the host has no such page
  function docsLink(page, anchor, o) {
    var url = window.hkShell.docsUrl(page, anchor);
    if (!url) return null;
    // HK Frontend's wiki on GitHub; a host's own docs (a path of its own) are its docs
    var row = K.nav(Object.assign({ label: /^https?:/.test(url) ? 'On the Wiki' : 'In the Docs', icon: 'mdi:open-in-new', href: url }, o));
    var a = row.tagName === 'A' ? row : row.querySelector && row.querySelector('a');
    if (a) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    return row;
  }
  // SLEEP SCREEN'S LISTS (sleep_rules.py): each a page of entities, as many
  // as the house has. `quiet`: its own may also work in quiet hours.
  var SLEEP_LISTS = {
    presence: { title: 'Presence', key: 'presence',
      help: 'Somebody is in the room while any of these is on — motion, occupancy, a radar, a watch’s room — and for the Linger time after the last one clears. With none, the room always counts as occupied.' },
    lit: { title: 'Only While Lit', key: 'lit', domains: ['light', 'switch'],
      help: 'Somebody walking in wakes the tablet only while one of these is on, so a dark room stays dark at night. A tap always works.' },
    quiet: { title: 'Quiet While', key: 'quiet_while',
      help: 'Quiet hours while any of these is on (a Good Night or nap timer), as well as by the schedule: the tablet stays dark, and only a tap, or what is allowed in quiet hours under Hold While and Wake For, changes that.' },
    reset: { title: 'Sleep Until Re-entered', key: 'reset',
      help: 'Turning one of these on darkens the tablet even with somebody still in the room; it wakes again when somebody comes back in. A tap still lights it. (Good Night.)' },
    dark: { title: 'Stay Dark While', key: 'dark_while',
      help: 'Dark while any of these is on (away mode). Wake For, Hold While and Keep Awake While still come first.' },
    awake: { title: 'Keep Awake While', key: 'awake_while',
      help: 'The dashboard stays up while any of these is on — watching TV on it, say, with no touch to keep it in use.' },
    hold: { title: 'Hold While', key: 'hold_while', quiet: true,
      help: 'Left exactly as it is while any of these is on: an automation of yours owns the tablet then (the doorbell’s pop-up, the alarm).' },
    wake: { title: 'Wake For', key: 'wake_for', quiet: true,
      help: 'Wakes to the dashboard, and stays up, while any of these is on (smoke, a leak).' },
    night: { title: 'Night While', key: 'night_while',
      help: 'The night brightness while any of these is on (a Good Night or nap timer) — whatever the clock says. Day While still wins.' },
    day: { title: 'Day While', key: 'day_while',
      help: 'The day brightness while any of these is on, even at night — the bathroom’s lights turned up bright, say.' }
  };
  // THE THIRD-PARTY CARDS' OPTIONS: the handful people change, as controls
  // (an empty YAML box does not say what it wants), each showing the tuned value until changed (hk-strategy.js
  // wallpanel(), kiosk_mode, the Weather page's radar card). A control writes
  // one key of the same options mapping the YAML page edits; set back to the
  // tuned value, the key goes. Everything else: Options in YAML.
  var MIN = function (n) { return n < 60 ? n + ' Seconds' : n === 60 ? '1 Minute' : n < 3600 ? (n / 60) + ' Minutes' : '1 Hour'; };
  var OPTION_PAGES = {
    wallpanel: {
      title: 'Screensaver Options', docs: 'https://github.com/j-a-n/lovelace-wallpanel',
      footer: 'The photos come from Screensaver Photos (All Screens → Screensaver). The clock, the weather, what’s playing and running timers show over them.',
      example: 'idle_time: 300\ndisplay_time: 20\nimage_animation_ken_burns_zoom: 1.2',
      yamlHelp: 'Everything set on the Screensaver Options page, and any other WallPanel option, as YAML. Empty is the tuned screensaver. Set a key to null to remove it from the tuned setup. Changing enabled, profiles or screensaver_entity unhooks it from the tablet’s user and the sky.',
      groups: [
        { header: 'Timing', rows: [
          { key: 'idle_time', label: 'Starts After', type: 'select', num: true, def: 180,
            options: [60, 120, 180, 300, 600, 900, 1800].map(function (n) { return [n, MIN(n)]; }) },
          { key: 'display_time', label: 'Each Photo For', type: 'select', num: true, def: 30,
            options: [10, 20, 30, 60, 120, 300].map(function (n) { return [n, MIN(n)]; }) }] },
        { header: 'Photos', rows: [
          { key: 'media_order', label: 'Order', type: 'seg', def: 'random', options: [['random', 'Random'], ['sorted', 'In Order']] },
          { key: 'image_animation_ken_burns', label: 'Slow Zoom', type: 'switch', def: true },
          { key: 'image_fit_landscape', label: 'Fill the Screen', sub: 'Off: the whole photo, with room around it.', type: 'switch',
            def: 'cover', on: 'cover', off: 'contain' }] }]
    },
    kiosk: {
      title: 'Kiosk Mode Options', docs: 'https://github.com/NemesisRE/kiosk-mode',
      footer: 'Whatever is hidden, the menu’s Home Assistant section still reaches Home Assistant (Show Menu opens its sidebar).',
      example: 'admin_settings:\n  hide_header: false',
      yamlHelp: 'Everything set on the Kiosk Mode Options page, and any other Kiosk Mode option, as YAML. Empty is the tuned setup: the header and the sidebar hidden. Set a key to null to remove it.',
      groups: [{ rows: [
        { key: 'hide_header', label: 'Hide Header', type: 'switch', def: true },
        { key: 'hide_sidebar', label: 'Hide Sidebar', type: 'switch', def: true },
        { label: 'Show Header for Admins', type: 'switch', fk: 'admin_header',
          get: function (cur) { return !!(cur.admin_settings && cur.admin_settings.hide_header === false); },
          set: function (cur, v) {
            var a = Object.assign({}, cur.admin_settings || {});
            if (v) a.hide_header = false; else delete a.hide_header;
            if (Object.keys(a).length) cur.admin_settings = a; else delete cur.admin_settings;
            return cur;
          } }] }]
    }
  };
  function optGet(r, cur) {
    if (r.get) return r.get(cur);
    var v = cur[r.key] === undefined ? r.def : cur[r.key];
    if (r.type === 'switch' && r.on !== undefined) return v === r.on;
    return v === undefined ? '' : v;
  }
  function optSet(r, cur, v) {
    var next = JSON.parse(JSON.stringify(cur || {}));
    if (r.set) return r.set(next, v);
    if (r.type === 'switch' && r.on !== undefined) v = v ? r.on : r.off;
    if (r.num && v !== '') v = Number(v);
    if (v === r.def || ((r.def === undefined) && (v === '' || v === null))) delete next[r.key];
    else next[r.key] = v;
    return next;
  }
  var TILE_DOMAINS = /^(light|switch|fan|cover|lock|media_player|climate|vacuum|valve|humidifier|water_heater|alarm_control_panel|input_boolean|timer|camera)\./;
  var CHIP_POOL = /^(sensor|binary_sensor|input_boolean|input_number|input_select|input_text|switch|light|fan|lock|cover|climate|media_player|timer|counter|person|device_tracker|weather|alarm_control_panel|vacuum|valve|water_heater|humidifier|select|number|update|event)\./;
  var FAV_POOL = /^(light|switch|fan|cover|lock|climate|media_player|alarm_control_panel|vacuum|valve|water_heater|humidifier|input_boolean|scene|script)\./;
  var SCENE_POOL = /^(scene|script|input_button|button)\./;

  class HkSettingsPanel extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.errors = {};
      this.pickers = {};
      this.q = '';
      this.hist = [];
      this.from = loadFrom();
      this._onHash = this.onHash.bind(this);
      this._onClick = this.onClick.bind(this);
      // A PRESS IN PROGRESS: see render(). Released after the press's click.
      var self = this;
      // NOT a press on a pop-up menu (a <select>): its list is the browser's
      // own, and on a Mac that list swallows the release -- the page heard no
      // pointerup, every redraw after the choice was held, and the row kept
      // showing where the page had been until the next click anywhere
      this._onPress = function (e) {
        var t = e && e.composedPath ? e.composedPath()[0] : e && e.target;
        if (t && t.tagName === 'SELECT') return;
        self._pressing = true;
      };
      this._onRelease = function () {
        if (!self._pressing) return;
        setTimeout(function () {
          self._pressing = false;
          var held = self._held;
          self._held = null;
          if (held) self.render(held.background, held.navigated);
        }, 0);
      };
      // typing over: a redraw skipped while typing (render(true)) is drawn now
      this._onFocusOut = function () {
        setTimeout(function () {
          if (self._dirty && !self.typing()) { self._dirty = false; self.render(true); }
        }, 0);
      };
    }
    // THE HOST'S ENTRY (window.hkHostClient.entry, below): Home Assistant's
    // panel_custom hands this element the frontend's object; the page gets
    // the host adapter's client for each new one, and reads `this.client`.
    // The first one starts the page; each one may change light/dark.
    _onClient(client) {
      var first = !this._hadClient;
      this._hadClient = client;
      if (first) this.boot();
      var dark = !!(client && client.themes && client.themes.darkMode);
      if (dark !== this.hasAttribute('dark')) this.toggleAttribute('dark', dark);
      // the host's own sidebar button, when it drew one, follows the client
      if (this._menuBtn) window.hkShell.menuButton(this._menuBtn, { client: client });
    }
    set narrow(v) { this._narrow = v; if (this._menuBtn) window.hkShell.menuButton(this._menuBtn, { narrow: v }); if (this.ready) this.render(); }
    set panel(v) { this._panel = v; }
    set route(v) { /* our own hash is the route */ }
    // NAVIGATION: our own links are "#/..." and handled here. Home Assistant
    // routes link clicks itself (history.pushState, which fires no
    // hashchange): the address would change and the page would not. So a
    // click on one of ours is ours, and HA's own navigation events are heard
    // too.
    connectedCallback() {
      window.addEventListener('hashchange', this._onHash);
      window.addEventListener('popstate', this._onHash);
      window.hkShell.onNavigate(this._onHash);
      this.shadowRoot.addEventListener('pointerdown', this._onPress, true);
      window.addEventListener('pointerup', this._onRelease, true);
      // a choice made is a press over, whatever the browser told us
      this.shadowRoot.addEventListener('change', this._onRelease, true);
      window.addEventListener('pointercancel', this._onRelease, true);
      this.shadowRoot.addEventListener('focusout', this._onFocusOut);
      if (this.ready) { this.subscribe(); this.render(); }
    }
    disconnectedCallback() {
      window.removeEventListener('hashchange', this._onHash);
      window.removeEventListener('popstate', this._onHash);
      window.hkShell.offNavigate(this._onHash);
      this.shadowRoot.removeEventListener('pointerdown', this._onPress, true);
      window.removeEventListener('pointerup', this._onRelease, true);
      window.removeEventListener('pointercancel', this._onRelease, true);
      this.shadowRoot.removeEventListener('change', this._onRelease, true);
      this.shadowRoot.removeEventListener('focusout', this._onFocusOut);
      this._pressing = false; this._held = null;
      // nothing of this page's keeps running while it is away: a reload due,
      // a preview frame still being asked for its sky or screensaver, the
      // bar's status fading
      clearTimeout(this._soonT); clearTimeout(this._stT);
      clearInterval(this._skyWait); clearInterval(this._saverWait);
      this._soonT = this._stT = this._skyWait = this._saverWait = null;
      if (this._unsub) { try { this._unsub(); } catch (e) { /* gone */ } this._unsub = null; }
    }

    // ---------------------------------------------------------- start
    async boot() {
      var s = this.shadowRoot, self = this;
      s.innerHTML = '<div class="loading">Loading…</div>';
      ensureFont();
      var v = stamp(this._panel);
      try {
        await Promise.all([import('/hk/panels/hk-settings-model.js?v=' + v), import('/hk/panels/hk-settings-kit.js?v=' + v),
                           import('/hk/panels/hk-settings-features.js?v=' + v), import('/hk/modules/hk-settings.js?v=' + v),
                           import('/hk/modules/hk-flat-image.js?v=' + v)]);
      } catch (e) {
        s.innerHTML = '<div class="loading">HK settings couldn’t load: ' + String(e && e.message || e) + '</div>';
        return;
      }
      M = window.hkSettingsModel; K = window.hkSettingsKit; h = K.h; F = window.hkSettingsFeatures; F.use(K);
      s.innerHTML = '<style>' + K.CSS + '\n' + CSS + '</style>' +
        '<div class="app" data-view="root"><nav class="side" aria-label="HK settings"></nav>' +
        '<main class="detail"><div class="bar"><div class="lead"></div><div class="mid" aria-hidden="true"></div>' +
        '<div class="st" role="status" aria-live="polite"></div></div><div class="scroll"><div class="page"></div></div></main></div>' +
        '<div class="live" aria-live="assertive"></div>';
      s.addEventListener('click', this._onClick);
      this.app = s.querySelector('.app');
      this.sideEl = s.querySelector('.side');
      this.bar = s.querySelector('.bar');
      this.scrollEl = s.querySelector('.scroll');
      this.pageEl = s.querySelector('.page');
      this.liveEl = s.querySelector('.live');
      this.scrollEl.addEventListener('scroll', function () {
        self.bar.classList.toggle('scrolled', self.scrollEl.scrollTop > 30);
      }, { passive: true });
      this.sideEl.addEventListener('scroll', function () {
        self.sideEl.classList.toggle('scrolled', self.sideEl.scrollTop > 2);
      }, { passive: true });
      new ResizeObserver(function () { self.measure(); }).observe(this);
      this.measure();
      // THE HOST'S PAGES ONLY (someone who may not change the house's): HK's
      // own settings are never read
      var hx = this.host();
      this.hostOnly = !!(hx && hx.house === false);
      if (this.hostOnly) {
        this.data = null;
        this.ready = true;
        this.onHash();
        return;
      }
      try { await this.reload(); } catch (e) {
        s.querySelector('.page').innerHTML = '';
        this.pageEl.appendChild(h('div', { class: 'big' }, [h('h2', { text: this.title() }),
          h('p', { text: String(e && e.message || e) })]));
        this.app.setAttribute('data-view', 'detail');
        return;
      }
      this.ready = true;
      this.subscribe();
      if (!location.hash && !this.data.setup_done && !this.data.dashboards.some(function (d) { return d.item; })) {
        history.replaceState(null, '', '#/setup');
      }
      this.onHash();
    }
    measure() {
      var w = this.getBoundingClientRect().width || window.innerWidth;
      // TWO COLUMNS from 700 px, as iOS Settings on an iPad: every iPad held
      // upright (744 to 1032 px) gets the list beside the page, a phone one
      // column (below 700 even in landscape: 932 px is the widest iPhone, but
      // 844 x 390 has no height for a sidebar, so that is height-checked)
      var tall = (this.getBoundingClientRect().height || window.innerHeight) >= 500;
      var wide = w >= 700 && tall, xwide = w >= 1320;
      var changed = wide !== this.hasAttribute('wide') || xwide !== this.hasAttribute('xwide');
      this.toggleAttribute('wide', wide);
      this.toggleAttribute('xwide', xwide);
      if (changed && this.ready) this.render();
      if (this._fit) this._fit();
    }
    async reload() {
      this.data = await this.client.callWS({ type: DOMAIN + '/panel/get' });
    }
    // every change, from here or anywhere (Configure, a gear, another
    // browser), comes back over the settings feed: read again and redraw
    // A subscription still on its way when the page is taken away is ended
    // the moment it arrives -- else it would live on unseen, reloading the
    // whole page's settings at every change made anywhere
    subscribe() {
      var port = this.client && this.client.subscriptions;
      if (this._unsub || this._subbing || !port) return;
      var self = this, first = true;
      this._subbing = true;
      port.subscribeMessage(function () {
        if (first) { first = false; return; }
        self.soon();
      }, { type: DOMAIN + '/settings/subscribe' }).then(function (u) {
        self._subbing = false;
        if (self.isConnected) self._unsub = u;
        else { try { u(); } catch (e) { /* gone */ } }
      }).catch(function () { self._subbing = false; /* older server */ });
    }
    soon() {
      var self = this;
      clearTimeout(this._soonT);
      this._soonT = setTimeout(function () {
        self.reload().then(function () { self.render(true); }).catch(function () { /* next change */ });
      }, 450);
    }

    // ---------------------------------------------------------- routing
    parts() {
      return (location.hash || '').replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
    }
    // THE HOST'S SETTINGS (above), read once when the page starts
    host() {
      if (this._host === undefined) {
        var o = null;
        try { o = window.hkShell && window.hkShell.settingsHost ? window.hkShell.settingsHost() : null; } catch (e) { o = null; }
        this._host = o && typeof o === 'object' ? o : null;
      }
      return this._host;
    }
    title() { var x = this.host(); return (x && x.title) || 'HK Settings'; }
    hostScreenBase() { var x = this.host(); return (x && typeof x.screenBase === 'string') ? x.screenBase : ''; }
    hostNote(key) { var x = this.host(); return (x && x.notes && x.notes[key]) || null; }
    // the page an empty address shows: Overview, or the host's first
    rootPage() {
      var x = this.host();
      if (x && typeof x.first === 'function') {
        var f = x.first();
        if (f) { var pg = x.page(String(f).split('/'), this); if (pg) return pg; }
      }
      return this.hostOnly ? { title: this.title(), top: true, body: function () {} } : this.p_overview();
    }
    onClick(e) {
      if (e.defaultPrevented && !this._hashLink(e)) return;
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = this._hashLink(e);
      if (!a || a.getAttribute('target')) return;
      e.preventDefault();
      e.stopPropagation();
      var href = a.getAttribute('href');
      this.noteFrom(location.hash || '#/', href, !!(a.closest && a.closest('.side')));
      this.go(href);
    }
    // BACK GOES WHERE YOU CAME FROM, not to a page's fixed parent: in the
    // Setup Assistant, Radar Map's Back must return to the step, not to the
    // Weather page. A page opened by a link from anywhere else remembers that
    // page, and Back -- the bar's, and any "done, go back" -- returns there:
    // the wizard's step, the screen that linked to All Screens' glass. A
    // link to a page's own child, and anything from the sidebar or search,
    // starts fresh. Kept for the browser session, so a reload keeps it.
    noteFrom(from, to, fresh) {
      from = hashOf(from); to = hashOf(to);
      if (from === to) return;
      if (fresh) { delete this.from[to]; }
      else if (to === this.backHref(from)) { return; }         // going up: `to` keeps its own
      else if (this.staticBack(to) === from) { delete this.from[to]; }
      else { this.from[to] = from; }
      saveFrom(this.from);
    }
    staticBack(hash) {
      var parts = hashOf(hash).replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
      var pg = null;
      try { pg = this.resolve(parts); } catch (e) { return null; }
      return pg && pg.back ? hashOf(pg.back[1]) : (parts.length ? '#/' : null);
    }
    backHref(hash) { hash = hashOf(hash); return this.from[hash] || this.staticBack(hash); }
    labelOf(hash) {
      var parts = hashOf(hash).replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
      if (!parts.length) return this.title();
      try { var pg = this.resolve(parts); return (pg && (pg.backLabel || pg.title)) || 'Back'; } catch (e) { return 'Back'; }
    }
    _hashLink(e) {
      var path = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var n = path[i];
        if (n === this) break;
        if (n.tagName === 'A') return String(n.getAttribute('href') || '').charAt(0) === '#' ? n : null;
      }
      return null;
    }
    onHash() {
      // an old address shows the new one (Pages, 2026-10-16: M.routeForward;
      // the host's own: its forward)
      var hx = this.host(), here = this.parts().join('/');
      var fw = (hx && typeof hx.forward === 'function' && hx.forward(here)) || (this.hostOnly ? null : M.routeForward(here));
      if (fw) { try { history.replaceState(null, '', '#/' + fw.split('/').map(encodeURIComponent).join('/')); } catch (e) { /* no history */ } }
      var cur = location.hash || '#/';
      // hashchange, popstate and HA's location-changed can all say the same
      if (cur === this._seen && this.hist.length) return;
      this._seen = cur;
      // a rename left half-done is let go with the page
      this._renaming = null; this._renameDraft = null; this._renameErr = null;
      // our own history, to know whether Back can simply go back
      if (this.hist.length > 1 && this.hist[this.hist.length - 2] === cur) this.hist.pop();
      else if (this.hist[this.hist.length - 1] !== cur) this.hist.push(cur);
      // A SCREEN'S FIELD ERRORS ARE THAT SCREEN'S. They are kept by setting
      // (`b:<key>`), and every screen's page has the same settings: a refused
      // Kitchen Tablet Room showed under Loft's and Master Bathroom's too. On
      // to another screen, they go.
      var screen = (/^#\/screens\/([^/?#]+)/.exec(cur) || [])[1] || null;
      if (screen !== this._errScreen) {
        var self = this;
        Object.keys(this.errors).forEach(function (k) { if (/^b:/.test(k)) delete self.errors[k]; });
        this._errScreen = screen;
      }
      this.render(false, true);
    }
    go(hash) {
      if ((location.hash || '#/') === hash) { if (this._seen !== hash) this.onHash(); else this.render(); }
      else location.hash = hash;                           // -> hashchange -> onHash
    }
    // back to `hash`: the browser's Back when that is where we came from.
    // A page's fixed parent means the page it was opened from, if any.
    back(hash) {
      var cur = hashOf(location.hash || '#/');
      if (this.from[cur] && hashOf(hash) === this.staticBack(cur)) hash = this.from[cur];
      if (this.hist.length > 1 && this.hist[this.hist.length - 2] === hash) history.back();
      else this.go(hash);
    }
    announce(text) {
      var l = this.liveEl;
      l.textContent = '';
      setTimeout(function () { l.textContent = text; }, 30);
    }

    // A SWITCH THAT ASKS FIRST (Automatic, Same as All Screens): K.toggle
    // shows its new state at once, so a Cancel draws the page again -- the
    // switch back where it was -- and only an OK runs `yes`.
    confirmSwitch(opts, yes) {
      var self = this;
      return K.confirm(this.shadowRoot, opts).then(function (ok) {
        if (ok) return yes();
        self.render();
        return false;
      });
    }

    // ---------------------------------------------------------- saving
    status(kind) {
      var st = this.bar.querySelector('.st'), self = this;
      clearTimeout(this._stT);
      st.className = 'st' + (kind === 'error' ? ' err' : '');
      if (kind === 'saving') {
        this._stT = setTimeout(function () { st.textContent = 'Saving…'; }, 350);
      } else if (kind === 'saved') {
        st.innerHTML = TICK + '<span>Saved</span>';
        this._stT = setTimeout(function () { st.textContent = ''; }, 1800);
      } else if (kind === 'error') {
        st.textContent = 'Couldn’t Save';
        this._stT = setTimeout(function () { st.textContent = ''; st.className = 'st'; }, 5000);
      } else st.textContent = '';
      void self;
    }
    // One change (or a few) to the house's settings. `local` shows it at
    // once; the answer is the truth.
    setH(changes) {
      var d = this.data;
      return this.save({ type: DOMAIN + '/settings/set', changes: changes }, Object.keys(changes), function () {
        Object.keys(changes).forEach(function (p) {
          if (p === 'sidebar' || p === 'files_folder') { d.integration[p] = changes[p]; return; }
          var i = p.indexOf('.'), sec = p.slice(0, i), key = p.slice(i + 1);
          // (a patch -- look.flat_colors.accent -- is its caller's to show)
          if (key.indexOf('.') >= 0) return;
          if (d.settings[sec]) d.settings[sec][key] = changes[p];
        });
      }, function (r) { if (r && r.settings) d.settings = r.settings; });
    }
    setB(path, changes) {
      var d = this.data;
      return this.save({ type: DOMAIN + '/board/set', dashboard: path, changes: changes },
        Object.keys(changes).map(function (k) { return 'b:' + k; }), function () {
          var whole = {};
          Object.keys(changes).forEach(function (k) { if (k.indexOf('.') < 0) whole[k] = changes[k]; });
          d.boards[path] = Object.assign({}, d.boards[path] || {}, whole);
        }, function (r) { if (r && r.board) d.boards[path] = r.board; });
    }
    // A FEATURE'S OWN SETTINGS (hk-settings-features.js): read with its
    // `<id>/settings/get`, kept here while the page is open, read
    // again in the background when a minute old; saved one change at a time
    // with its `/set`, whose answer is the page again.
    feat(domain) {
      var st = (this.feats = this.feats || {})[domain] || (this.feats[domain] = {});
      if (!st.loading && (!st.at || Date.now() - st.at > 60000)) this.featLoad(domain);
      return st;
    }
    async featLoad(domain, fresh) {
      var st = this.feats[domain], self = this;
      st.loading = true;
      try {
        st.data = await this.client.callWS(Object.assign({ type: domain + '/settings/get' }, fresh ? { fresh: true } : {}));
        st.error = null;
      } catch (e) {
        st.error = String((e && e.message) || e);
      }
      st.loading = false; st.at = Date.now();
      self.render(true);
    }
    featSet(domain, changes, keys) {
      var st = this.feat(domain);
      keys = keys || Object.keys(changes);
      return this.save({ type: domain + '/settings/set', changes: changes }, keys.map(function (k) { return 'f:' + domain + ':' + k; }),
        function () {
          if (!st.data) return;
          Object.keys(changes).forEach(function (k) {
            if (k in st.data && typeof changes[k] !== 'object') st.data[k] = changes[k];
          });
        }, function (r) { if (r) { st.data = r; st.at = Date.now(); } });
    }
    // any other command of the feature's (add, remove, a set that names an
    // entry): its answer is the page again
    featCall(domain, msg, keys) {
      var st = this.feat(domain);
      return this.save(msg, (keys || []).map(function (k) { return 'f:' + domain + ':' + k; }), function () {},
        function (r) { if (r) { st.data = r; st.at = Date.now(); } });
    }
    ws(msg, keys) {
      var self = this;
      return this.save(msg, keys || [], function () {}, function () {});
    }
    async save(msg, keys, local, apply) {
      var self = this;
      local();
      keys.forEach(function (k) { delete self.errors[k]; });
      this.render();
      this.status('saving');
      try {
        var r = await this.actions().callWS(msg);
        apply(r);
        this.status('saved');
        this.render();
        this.soon();
        return true;
      } catch (e) {
        var f = M.refusals(e);
        keys.forEach(function (k) {
          var code = f ? f[k.replace(/^[bt]:/, '').replace(/^f:[a-z_]+:/, '')] : null;
          self.errors[k] = code ? M.errorText(code) : (f ? null : String((e && e.message) || e));
          if (!self.errors[k]) delete self.errors[k];
        });
        if (!keys.length) this.errors._ = String((e && e.message) || e);
        this.status('error');
        this.announce('Couldn’t save. ' + (Object.keys(self.errors).map(function (k) { return self.errors[k]; })[0] || ''));
        try { await this.reload(); } catch (x) { /* keep what we have */ }
        this.render();
        return false;
      }
    }

    // ---------------------------------------------------------- drawing
    typing() {
      var a = this.shadowRoot.activeElement;
      return !!(a && (a.tagName === 'INPUT' && a.type !== 'range' || a.tagName === 'TEXTAREA' ||
                      a.closest && a.closest('.accwrap')));
    }
    render(background, navigated) {
      if (!this.ready || (!this.data && !this.hostOnly)) return;
      // NOT UNDER A PRESS. A text field saves on blur, and the blur of a press
      // elsewhere comes between that press's pointerdown and its click: the
      // redraw replaced the very row being pressed, and the click was lost
      // (a kind picked once did nothing; Add Pop-up needed a second tap).
      // Held until the press has ended and clicked, then drawn once.
      if (this._pressing) {
        var was = this._held || {};
        this._held = { background: !!(was.background !== undefined ? was.background && background : background),
                       navigated: !!(was.navigated || navigated) };
        return;
      }
      if (background && this.typing()) { this._dirty = true; return; }
      var self = this, parts = this.parts(), key = parts.join('/');
      var wide = this.hasAttribute('wide');
      var active = this.shadowRoot.activeElement;
      var fk = active && active.getAttribute && active.getAttribute('data-fk');
      var inSide = active && this.sideEl.contains(active);
      var top = this.scrollEl.scrollTop;
      var root = !parts.length;
      this.app.setAttribute('data-view', root && !wide ? 'root' : 'detail');
      if (wide || root) this.paintSide(parts);
      var pg = root ? this.rootPage() : this.resolve(parts);
      this.pickers = this.pickers || {};
      this.paintPage(pg, parts);
      if (key === this._last) this.scrollEl.scrollTop = top;
      else { this.scrollEl.scrollTop = 0; this.bar.classList.remove('scrolled'); }
      this._last = key;
      var t = null;
      if (fk) {
        var sel = '[data-fk="' + String(fk).replace(/(["\\])/g, '\\$1') + '"]';
        t = (inSide ? this.sideEl : this.shadowRoot).querySelector(sel);
        if (t && t.focus) t.focus({ preventScroll: true });
      }
      if (!t && navigated && !inSide) {
        var h1 = this.pageEl.querySelector('h1');
        if (h1) h1.focus({ preventScroll: true });
      }
      if (this._flash) {
        // a setting's key (search), or a list of a row's controls (a page's
        // On Screens: its row on the screen's Pages on This Screen)
        var pe = this.pageEl, el = null;
        if (Array.isArray(this._flash)) {
          this._flash.some(function (fk) {
            var x = pe.querySelector('[data-fk="' + fk + '"]');
            if (x) el = (x.closest && x.closest('.cell, li, [role=listitem]')) || x;
            return !!el;
          });
        } else el = pe.querySelector('[data-sk="' + this._flash + '"]');
        this._flash = null;
        if (el) {
          el.scrollIntoView({ block: 'center' });
          el.classList.add('flash');
          setTimeout(function () { el.classList.remove('flash'); }, 1500);
        }
      }
      this._dirty = false;
      // WALL TABLETS ARE LIVE: their state, battery and checks are read from
      // Home Assistant's states, so their pages are drawn again every 10 s
      // while open (not under a press or while typing: render's own rules)
      // (only Wall Tablets' own pages: a screen's page has its live preview)
      var onTabs = parts[0] === 'house' && parts[1] === 'tablets';
      if (onTabs && !this._tabTick) {
        this._tabTick = setInterval(function () {
          var q = self.parts();
          if (!self.isConnected || !(q[0] === 'house' && q[1] === 'tablets')) {
            clearInterval(self._tabTick); self._tabTick = null; return;
          }
          if (q[2] !== 'add' && q[3] !== 'copy') self.render(true);
        }, 10000);
      }
      void self;
    }
    // A SCREEN'S NAME AND ITS PENCIL (pg.rename: the dashboard). The pencil
    // turns the title into a field; Save (or Return) renames the dashboard,
    // Cancel (or Escape) leaves it. Its address -- and so every link, tablet
    // and automation that opens it -- stays.
    titleLine(pg) {
      var self = this, x = pg.rename;
      if (this._renaming !== x.path) {
        var pen = h('button', { class: 'ren', type: 'button', 'aria-label': 'Rename ' + x.title, 'data-fk': 'rename', 'data-sk': 'b:rename' });
        pen.innerHTML = PENCIL;
        pen.addEventListener('click', function () {
          self._renaming = x.path; self._renameErr = null; self.render();
          var inp = self.shadowRoot.querySelector('.renform input');
          if (inp) { inp.focus(); inp.select(); }
        });
        return h('div', { class: 'tline' }, [h('h1', { class: 'lt', tabindex: '-1', text: pg.title || '' }), pen]);
      }
      var inp = h('input', { type: 'text', 'aria-label': 'Name', maxlength: 50, 'data-fk': 'rename:input', spellcheck: 'false',
                             autocomplete: 'off' });
      inp.value = this._renameDraft != null ? this._renameDraft : x.title;
      var ok = h('button', { class: 'ok', type: 'button', text: 'Save', 'data-fk': 'rename:save' });
      var no = h('button', { class: 'no', type: 'button', text: 'Cancel', 'data-fk': 'rename:cancel' });
      var paint = function () { ok.disabled = !inp.value.trim() || self._renameBusy; };
      var cancel = function () { self._renaming = null; self._renameDraft = null; self._renameErr = null; self.render(); };
      var save = function () { self.renameScreen(x, inp.value); };
      inp.addEventListener('input', function () { self._renameDraft = inp.value; self._renameErr = null; paint(); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); if (!ok.disabled) save(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      });
      ok.addEventListener('click', save);
      no.addEventListener('click', cancel);
      paint();
      var out = h('div', {}, [h('div', { class: 'renform' }, [inp, ok, no]),
        this._renameErr ? h('p', { class: 'renerr', role: 'alert', text: this._renameErr }) : null]);
      return out;
    }
    async renameScreen(x, title) {
      title = String(title || '').trim();
      if (!title || this._renameBusy) return;
      if (title === x.title) { this._renaming = null; this._renameDraft = null; this.render(); return; }
      this._renameBusy = true;
      this.status('saving');
      try {
        // the dashboard itself: its title is the sidebar's name
        await this.actions().callWS({ type: 'lovelace/dashboards/update', dashboard_id: x.id, title: title });
        // ...and the screen's own item (and its screensaver's device) after it
        await this.actions().callWS({ type: DOMAIN + '/dashboard/titled', dashboard: x.path });
        this._renaming = null; this._renameDraft = null; this._renameErr = null;
        try { await this.reload(); } catch (e) { x.title = title; }
        this.status('saved');
        this.announce('Renamed to ' + title + '.');
      } catch (e) {
        this._renameErr = 'Couldn’t rename it: ' + String((e && e.message) || e);
        this.status('error');
      }
      this._renameBusy = false;
      this.render();
    }
    paintPage(pg, parts) {
      var self = this, wide = this.hasAttribute('wide');
      // THE BAR: Back to the page above (none beside the sidebar at the top)
      var lead = this.bar.querySelector('.lead');
      lead.innerHTML = '';
      var back = pg.back || (parts.length && !wide ? [this.title(), '#/'] : null);
      var came = this.from[hashOf(location.hash || '#/')];
      if (came && (!back || hashOf(back[1]) !== came)) back = [this.labelOf(came), came];
      if (back && (!(wide && pg.top) || came)) {
        var b = h('button', { class: 'back', type: 'button', 'aria-label': 'Back to ' + back[0] });
        b.innerHTML = BACK + '<span>' + K.esc(back[0]) + '</span>';
        b.addEventListener('click', function () { self.back(back[1]); });
        lead.appendChild(b);
      }
      this.bar.querySelector('.mid').textContent = pg.title || '';
      // THE PAGE. A screen's preview stays put while its settings redraw (a
      // moved iframe would load the whole dashboard again).
      var head = h('div', { class: 'ph' }, [pg.rename ? this.titleLine(pg) : h('h1', { class: 'lt', tabindex: '-1', text: pg.title || '' }),
        pg.scope ? h('p', { class: 'scope', html: pg.scope }) : null]);
      var content = h('div', { class: 'pc' });
      try { pg.body(content); } catch (e) {
        console.error('[hk-settings]', e);
        content.appendChild(K.group({ footer: 'This page couldn’t be drawn: ' + (e && e.message || e) }, []));
      }
      // beside the page (a wide window) it stays for the screen's sub-pages;
      // above it (narrower, phones too) only the screen's own page has it --
      // unless it is PINNED (the bar's Preview button): then it stays at the
      // top of every page that has one, the settings scrolling under it
      var xwide = this.hasAttribute('xwide');
      var pinned = !xwide && !!pg.preview && pinnedPreview();
      this.previewButton(!xwide && !!pg.preview, pinned);
      if (pg.preview && !xwide && !pg.previewTop && !pinned) pg.preview = null;
      this._pvPinned = pinned;
      var keepPv = pg.preview && this._pv && this._pv.path === pg.preview && this._pv.view === (pg.previewView || '0') &&
        this._pv.pinned === pinned && this.pageEl.querySelector('.pvcol');
      if (keepPv) {
        this.pageEl.replaceChild(head, this.pageEl.querySelector('.ph'));
        this.pageEl.replaceChild(content, this.pageEl.querySelector('.pc'));
      } else {
        this.pageEl.innerHTML = '';
        this.pageEl.className = 'page' + (pg.preview ? ' split' : '');
        this.pageEl.appendChild(head);
        this._pv = null; this._fit = null;
        if (pg.preview) {
          var pcol = this.previewCol(pg.preview, pg.previewView);
          if (pinned) { pcol.classList.add('pin'); this._pv.pinned = true; this.pageEl.insertBefore(pcol, head); }
          else this.pageEl.appendChild(pcol);
        }
        this.pageEl.appendChild(content);
      }
      // a first group with no heading (a theme's page): the preview's box
      // lines up with that group, not its PREVIEW heading with nothing
      var first = content.firstElementChild;
      this.pageEl.classList.toggle('nohead', !!(pg.preview && first && first.classList &&
        first.classList.contains('grp') && !(first.firstElementChild && first.firstElementChild.classList.contains('gh'))));
      this.skyPreview(pg.preview ? pg.sky : null);
      this._saverEnergy = !!pg.saverEnergy;
      this._saverWx = !!pg.saverWeather;
      this.saverPreview(!!(pg.preview && pg.saverPreview), !!pg.saverHouse);
    }

    // THE PREVIEW BUTTON (narrower than a desk): the live preview pinned to
    // the top of the page, or not; remembered in this browser. A pin and a
    // word, Pin or Pinned: an eye alone did not say what it does.
    previewButton(show, pinned) {
      var b = this.bar.querySelector('.pvtoggle'), self = this;
      if (!show) { if (b) b.remove(); return; }
      if (!b) {
        b = h('button', { class: 'pvtoggle', type: 'button', 'data-fk': 'bar:preview' });
        b.addEventListener('click', function () {
          pinPreview(!pinnedPreview());
          self.render();
        });
        this.bar.appendChild(b);
      }
      b.innerHTML = '';
      b.appendChild(K.icon('mdi:pin', ''));
      b.appendChild(h('span', { text: pinned ? 'Pinned' : 'Pin' }));
      b.setAttribute('aria-label', 'Pin Preview');
      b.title = pinned ? 'Unpin the preview from the top' : 'Pin the preview to the top while you scroll';
      b.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    }
    // THE SCREENSAVER'S PREVIEW: on Screensaver Options the frame shows the
    // screensaver as that screen shows it (its window's hkSaver.preview) and
    // follows every change made here; any other page takes it away again.
    // Only the frame: the screen's tablet, its switch and its photos' order
    // are not touched.
    saverPreview(on, house) {
      if (house === undefined) house = this._saverHouse; else this._saverHouse = house;
      var self = this, col = this.pageEl.querySelector('.pvcol');
      var old = col && col.querySelector('.pvsaver');
      if (old) old.remove();
      clearInterval(this._saverWait);
      var box = col && col.querySelector('.pvbox'), fr = box && box.querySelector('iframe');
      if (!fr) { this._saverWas = false; return; }
      if (!on && !this._saverWas) return;
      this._saverWas = on;
      var n = 0;
      // WHICH PHOTO (2026-10-13): Any, or a Portrait or Landscape one -- held
      // while its settings change, so a crop or a blur can be judged
      var shape = this._saverEnergy ? 'energy' : this._saverWx ? 'weather' : this._saverShape || '';
      var go = function () {
        var S = null;
        try { S = fr.contentWindow && fr.contentWindow.hkSaver; } catch (e) { /* not ours */ }
        if (S && typeof S.preview === 'function') { S.preview(on, shape || null, !!house); return true; }
        return false;
      };
      if (!go()) self._saverWait = setInterval(function () { if (go() || ++n > 80) clearInterval(self._saverWait); }, 250);
      if (on && (this._saverEnergy || this._saverWx)) {
        box.parentNode.insertBefore(h('div', { class: 'pvsaver' }, [h('p', { class: 'gf',
          text: (this._saverWx ? 'The weather' : 'Home Energy') + ' as this screen shows it, held while you change these. Only this preview changes.' })]), box.nextSibling);
      } else if (on) {
        var seg = h('div', { class: 'seg pvmoment', role: 'radiogroup', 'aria-label': 'Preview a photo' });
        [['', 'Any Photo'], ['portrait', 'Portrait'], ['landscape', 'Landscape']].forEach(function (o) {
          var b = h('button', { type: 'button', role: 'radio', 'aria-checked': o[0] === shape ? 'true' : 'false', tabindex: o[0] === shape ? '0' : '-1',
                                'data-fk': 'pvshape:' + (o[0] || 'any'), text: o[1] });
          b.addEventListener('click', function () { if (o[0] !== shape) { self._saverShape = o[0]; self.saverPreview(true); } });
          seg.appendChild(b);
        });
        box.parentNode.insertBefore(h('div', { class: 'pvsaver' }, [seg, h('p', { class: 'gf',
          text: (house ? 'The screensaver with these settings, shown on ' + ((self.dash(self._pv ? self._pv.path : '') || {}).title || 'a screen') + '.'
                       : 'The screensaver as this screen shows it, with the changes you make here.') +
                ' Portrait or Landscape keeps one photo of that shape while you change its settings. Only this preview changes.' })]), box.nextSibling);
      }
    }

    // THE SKY'S PREVIEW. On the Sky page the preview frame shows today's own
    // sky; on a theme's page, that theme -- whatever today's date, and even
    // switched off -- in the moments it can be seen in (M.skyMoments). It is
    // forced INSIDE the frame (its window's hkSky.preview): no real screen
    // changes, and any other page puts the frame back to today's sky.
    skyPreview(sky) {
      var self = this, col = this.pageEl.querySelector('.pvcol');
      var old = col && col.querySelector('.pvsky');
      if (old) old.remove();
      clearInterval(this._skyWait);
      var box = col && col.querySelector('.pvbox'), fr = box && box.querySelector('iframe');
      if (!fr) { this._skyWas = false; return; }
      var theme = sky ? sky.theme : null;
      // the frame's hkSky arrives with its dashboard: asked for until then
      var apply = function (when) {
        var n = 0;
        var go = function () {
          var S = null;
          try { S = fr.contentWindow && fr.contentWindow.hkSky; } catch (e) { /* not ours */ }
          if (S && typeof S.preview === 'function') { S.preview(theme, when); return true; }
          return false;
        };
        clearInterval(self._skyWait);
        if (go()) return;
        self._skyWait = setInterval(function () { if (go() || ++n > 80) clearInterval(self._skyWait); }, 250);
      };
      if (!sky) { if (this._skyWas) { theme = null; apply(null); } this._skyWas = false; return; }
      this._skyWas = true;
      var x = this.dash(this._pv && this._pv.path), who = x ? x.title : 'Home';
      var row = h('div', { class: 'pvsky' });
      if (!theme) {
        row.appendChild(h('p', { class: 'gf', text: 'Your ' + who + ' screen’s sky right now. Choose a decoration to see it here.' }));
        box.parentNode.insertBefore(row, box.nextSibling);
        apply(null);
        return;
      }
      var mo = M.skyMoments(theme), key = mo.value;
      if (mo.options.length > 1) {
        var seg = h('div', { class: 'seg pvmoment', role: 'radiogroup', 'aria-label': 'When' });
        var btns = mo.options.map(function (o) {
          var b = h('button', { type: 'button', role: 'radio', 'data-moment': o[0], text: o[1] });
          b.addEventListener('click', function () { choose(o[0]); });
          seg.appendChild(b);
          return b;
        });
        var paint = function () {
          btns.forEach(function (b, i) {
            var on = mo.options[i][0] === key;
            b.setAttribute('aria-checked', on ? 'true' : 'false');
            b.setAttribute('tabindex', on ? '0' : '-1');
          });
        };
        var choose = function (k) { if (k === key) return; key = k; paint(); apply(k); };
        paint();
        row.appendChild(seg);
      }
      row.appendChild(h('p', { class: 'gf', text: 'Your ' + who + ' screen with this decoration, whatever today’s date. Only this preview changes.' }));
      box.parentNode.insertBefore(row, box.nextSibling);
      apply(key);
    }

    // ---------------------------------------------------------- sidebar
    paintSide(parts) {
      var d = this.data, self = this, wide = this.hasAttribute('wide');
      var here = parts.join('/');
      var at = function (p) { return here === p || here.indexOf(p + '/') === 0; };
      var side = this.sideEl;
      var searchHad = side.querySelector('.search input');
      var focused = searchHad && this.shadowRoot.activeElement === searchHad;
      var selStart = focused ? searchHad.selectionStart : null;
      side.innerHTML = '';
      var top = h('div', { class: 'sidetop' });
      var head = h('div', { class: 'sidehead' });
      // A NARROW WINDOW: the host's own button that opens its sidebar (none
      // on a host without one)
      var mb = this._narrow ? window.hkShell.menuButton(this._menuBtn || null, { narrow: this._narrow, client: this.client }) : null;
      if (mb) {
        this._menuBtn = mb;
        head.appendChild(mb);
        head.classList.add('menubtn');
      }
      // a host with no sidebar of its own: its way out, over the name
      var hx = this.host();
      if (hx && hx.back && hx.back.href) {
        var out = h('a', { class: 'hostback', href: hx.back.href, 'data-fk': 'side:hostback' });
        out.innerHTML = BACK + '<span>' + K.esc(hx.back.label || 'Back') + '</span>';
        top.appendChild(out);
      }
      head.appendChild(h('h1', { text: this.title() }));
      top.appendChild(head);
      var sb = h('div', { class: 'search', role: 'search' });
      sb.appendChild(K.icon('mdi:magnify', 'mag'));
      var inp = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search settings', 'data-fk': 'side:search' });
      inp.value = this.q;
      inp.addEventListener('input', function () {
        self.q = inp.value;
        self.paintSide(self.parts());
      });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { self.q = ''; self.paintSide(self.parts()); } });
      sb.appendChild(inp);
      top.appendChild(sb);
      side.appendChild(top);
      if (focused) { inp.focus(); try { inp.setSelectionRange(selStart, selStart); } catch (e) { /* type=search */ } }

      if (this.q.trim()) { side.appendChild(this.searchResults()); return; }
      var hostGroups = function (place) {
        if (!hx || typeof hx.groups !== 'function') return;
        (hx.groups() || []).filter(function (g) { return (g.place || 'end') === place; }).forEach(function (g) {
          side.appendChild(K.group({ header: g.header || null }, (g.rows || []).map(function (r) {
            return K.nav({ tile: r.tile || null, label: r.label, sub: r.sub || null, value: r.value, href: '#/' + r.route,
                           current: wide && (at(r.route) || (!here && r.root)), fk: 'side:' + r.route });
          })));
        });
      };
      hostGroups('top');
      if (this.hostOnly) { hostGroups('end'); return; }
      var items = d.dashboards.filter(function (x) { return x.item; });
      var nAcc = Object.keys((d.accessories && d.accessories.entities) || {}).length;
      side.appendChild(K.group({}, [K.nav({ tile: ['mdi:home-heart', C.orange], label: 'Overview',
        sub: items.length + ' Screens · ' + nAcc + ' Accessories', href: '#/overview',
        current: wide && (here === '' || here === 'overview'), fk: 'side:overview' })]));
      var rows = items.map(function (x) {
        // A SCREEN OF ONLY SOME PAGES says so, with a glyph of its own: it
        // must never pass for a whole screen
        var only = x.generated ? self.onlyOf(d.boards[x.path]) : null;
        // WHERE IT IS DRAWN (`where`, from a host that draws screens of its own: {text, icon, also: drawn here too}) -- HK in Home
        // Assistant sends none, and its list is as it always was
        var where = x.where && typeof x.where.text === 'string' ? x.where : null;
        return K.nav({ tile: [only ? 'mdi:file-document-multiple-outline' : where && where.icon ? where.icon : x.generated ? 'mdi:view-dashboard-variant' : 'mdi:tablet-dashboard',
                              only ? C.teal : where && where.also ? C.blue : x.generated ? C.indigo : C.blue],
                       label: x.title, sub: only ? only.text : where ? where.text : null, href: '#/screens/' + encodeURIComponent(x.path),
                       current: wide && at('screens/' + x.path), fk: 'side:s:' + x.path });
      });
      rows.push(K.nav({ tile: ['mdi:plus', C.gray], label: 'Add Screen', href: '#/add-screen', current: wide && at('add-screen'),
                        fk: 'side:add' }));
      side.appendChild(K.group({ header: 'Screens' }, rows));
      // PAGES (2026-10-16): every page the house has, each its own settings
      // -- a feature's pages (#/features/energy/devices) count as its page's
      var pageHere = M.pageOfRoute(here);
      side.appendChild(K.group({ header: 'Pages' }, this.pagesListed().map(function (p) {
        return K.nav({ tile: [p[2], p[3]], label: p[1], href: '#/page/' + p[0], current: wide && pageHere === p[0], fk: 'side:page:' + p[0] });
      })));
      var list = function (header, arr, pre) {
        side.appendChild(K.group({ header: header }, arr.filter(function (p) { return p[4] !== 'unlisted'; }).map(function (p) {
          var r = p[5] || (pre || '') + p[0];
          return K.nav({ tile: [p[2], p[3]], label: p[1], href: '#/' + r, current: wide && at(r), fk: 'side:' + r });
        })));
      };
      list('All Screens', HOUSE, 'house/');
      list('Library', LIBRARY);
      list('System', SYSTEM);
      hostGroups('end');
    }
    searchResults() {
      var d = this.data, self = this, hx = this.host();
      var hostRows = hx && typeof hx.search === 'function' ? (hx.search() || []) : [];
      if (this.hostOnly) {
        var hres = M.search(this.q, [], hostRows).slice(0, 60);
        if (!hres.length) return K.group({ footer: 'No settings match “' + this.q.trim() + '”.' }, []);
        return K.group({ header: 'Results' }, hres.map(function (r, i) {
          return K.nav({ label: r.label, sub: r.where || null, href: '#/' + r.route, fk: 'side:r:' + i });
        }));
      }
      var screens = d.dashboards.filter(function (x) { return x.item; });
      var extra = hostRows.slice();
      screens.forEach(function (x) { extra.push({ label: x.title, route: 'screens/' + x.path, where: 'Screen', words: x.path }); });
      d.popups.forEach(function (p) { extra.push({ label: p.name || p.hash, route: 'popups/' + p.hash, where: 'Pop-up', words: '#' + p.hash }); });
      (d.custom_pages || []).forEach(function (p) { extra.push({ label: p.title, route: 'pages/' + p.path, where: 'Custom Page', words: p.path }); });
      extra = extra.concat(F.search(d.features));
      var areas = this.client.areas || {};
      Object.keys(areas).forEach(function (a) { extra.push({ label: areas[a].name, route: 'house/rooms/' + a, where: 'Room', words: 'room scenes' }); });
      var res = M.search(this.q, screens, extra).slice(0, 60);
      if (!res.length) return K.group({ footer: 'No settings match “' + this.q.trim() + '”.' }, []);
      return K.group({ header: 'Results' }, res.map(function (r, i) {
        var a = K.nav({ label: r.label, sub: r.where || null, href: '#/' + r.route, fk: 'side:r:' + i });
        // r.key is the row's own label (hk-settings-model.js search())
        a.addEventListener('click', function () { self._flash = r.key; });
        return a;
      }));
    }

    // ---------------------------------------------------------- helpers
    hs(path) { var i = path.indexOf('.'); return (this.data.settings[path.slice(0, i)] || {})[path.slice(i + 1)]; }
    err(sk) { return this.errors[sk] || null; }
    dash(path) { return this.data.dashboards.filter(function (x) { return x.path === path; })[0]; }
    // a dashboard Home Assistant can rename: one it stores (a YAML dashboard
    // is named in its YAML), with its collection id
    renamable(x) { return x && x.mode === 'storage' && x.id ? x : null; }
    name(id) {
      if (!id) return '';
      var a = ((this.data.accessories || {}).entities || {})[id];
      var st = this.client.states[id];
      return (a && a.name) || (st && st.attributes.friendly_name) || id;
    }
    areaOf(id) {
      var e = (this.client.entities || {})[id] || {}, devs = this.client.devices || {};
      return e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || '';
    }
    areaName(a) { var x = (this.client.areas || {})[a]; return (x && x.name) || a; }
    areasAZ() {
      var areas = this.client.areas || {};
      return Object.keys(areas).sort(function (p, q) { return String(areas[p].name).localeCompare(String(areas[q].name)); });
    }
    entityIds(filter) {
      var client = this.client, ents = client.entities || {};
      return Object.keys(client.states).filter(function (id) {
        var dom = id.split('.')[0];
        if (filter.domains && filter.domains.indexOf(dom) < 0) return false;
        if (filter.re && !filter.re.test(id)) return false;
        if (filter.dc && client.states[id].attributes.device_class !== filter.dc) return false;
        if (filter.shown) { var e = ents[id] || {}; if (e.hidden || e.entity_category) return false; }
        return true;
      });
    }
    // A ROW THAT PICKS AN ENTITY: its value is the entity's name (or what
    // "none" means), and it opens a searchable list.
    // "Same as General (Lyric Alarm)": the alarm panel General names
    sameAsGeneral() {
      var g = this.hs('security.alarm');
      return 'Same as the Security Page' + (g ? ' (' + this.name(g) + ')' : '');
    }
    entityRow(o) {
      var self = this;
      var href = this.picker(o.sk, {
        title: o.title || o.label, value: o.value, none: o.none, required: o.required,
        items: function () {
          return self.entityIds(o.filter).map(function (id) { return { value: id, label: self.name(id), sub: id }; });
        },
        onPick: o.onPick
      });
      var st = o.value && this.client.states[o.value];
      var val = o.value ? (st ? this.name(o.value) : o.value + ' (missing)') : (o.none || 'None'), sub = o.sub;
      // "Automatic (Main Power)", "Same as General (Lyric Alarm)": on the
      // row, the value it follows, and whose under the label -- as every
      // row that follows something says it (the picker keeps the whole name)
      var follows = !o.value && !sub && /^(Automatic|Same as [^(]+?) \((.+)\)$/.exec(val);
      if (follows) { sub = follows[1]; val = follows[2]; }
      var row = K.nav({ label: o.label, sub: sub, value: val, href: href, sk: o.sk });
      return this.withError(row, o.sk);
    }
    withError(row, sk) {
      var e = this.err(sk);
      if (!e) return row;
      return h('div', { class: 'cellwrap' }, [row, h('div', { class: 'errline', role: 'alert', text: e })]);
    }
    // register a picker page under the current page (#/<here>/~<key>)
    picker(key, spec) {
      var parts = this.parts().filter(function (p) { return p[0] !== '~'; });
      this.pickers[key] = spec;
      return '#/' + parts.map(encodeURIComponent).join('/') + '/~' + encodeURIComponent(key);
    }
    pickerPage(parts) {
      var self = this, key = parts[parts.length - 1].slice(1);
      var parentParts = parts.slice(0, -1);
      // a picker's page is registered by its page: draw that, unseen, first
      var parent = this.resolve(parentParts);
      var scratch = document.createElement('div');
      try { parent.body(scratch); } catch (e) { /* its picker may still be there */ }
      var spec = this.pickers[key];
      var backHash = '#/' + parentParts.map(encodeURIComponent).join('/');
      if (!spec) return { title: parent.title, back: [parent.title, backHash], body: function (c) { self.go(backHash); void c; } };
      return { title: spec.title, back: [parent.title, backHash], body: function (c) {
        var choose = function (v) {
          self._pq = null;
          self._psel = null;
          self.back(backHash);
          spec.onPick(v);
        };
        var sel = null;
        if (spec.multi) sel = self._psel && self._psel.key === key ? self._psel : (self._psel = { key: key, order: [] });
        self.pickList(c, { title: spec.title, items: spec.items, multi: !!spec.multi, sel: sel && sel.order,
          verb: spec.verb || 'Add', onDone: function (v) { choose(v); },
          current: spec.value, none: spec.none, onPick: choose,
          // the search is this picker's: another picker opens with none
          query: self._pq && self._pq.key === key ? self._pq.q : '', onQuery: function (q) { self._pq = { key: key, q: q }; } });
      } };
    }
    // THE PICKER (2026-10-13: every picker in HK Settings, after Hide
    // Accessories' -- the one the owner found "easy to understand and laid
    // out a lot cleaner"): a search that matches the name, the entity id and
    // the room; the choices under their rooms, A to Z, each with its glyph and
    // its entity id; and for several at once, ticks from the start with a bar
    // saying how many are selected, Clear, and the one button that finishes
    // (Add, Next). What is ticked stays ticked while the search changes;
    // while searching, Select All ticks everything it matches.
    //   o = { items(tab) -> [{ value, label, sub, room, icon, note }],
    //         tabs: [[id, text]], tab, onTab(id)      e.g. Accessories / Whole Devices
    //         multi, sel (the array ticked, kept by the caller), verb, onDone(values)
    //         current, none, onPick(value)            one choice: a tap picks it
    //         query, onQuery(q), title }
    // An entity's room is its area's (room: '' = No Room); a list where
    // nothing has a room is one plain list, with no headings.
    pickList(c, o) {
      var self = this, client = this.client;
      if (o.tabs) c.appendChild(K.group({}, [K.seg({ label: 'Pick', fk: 'pick:tab', value: o.tab, options: o.tabs,
        onChange: function (x) { o.onTab(x); } })]));
      var sb = h('div', { class: 'search', style: 'margin:0 0 ' + (o.multi ? 22 : 18) + 'px' });
      sb.appendChild(K.icon('mdi:magnify', 'mag'));
      var inp = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search' + (o.title ? ' ' + o.title : ''), 'data-fk': 'pick:search' });
      inp.value = o.query || '';
      sb.appendChild(inp);
      c.appendChild(sb);
      var bar = o.multi ? h('div', { class: 'pickbar', role: 'toolbar', 'aria-label': 'Selected' }) : null;
      if (bar) c.appendChild(bar);
      var box = h('div');
      c.appendChild(box);
      var sel = o.sel || [];
      var tick = function (v) { var i = sel.indexOf(v); if (i >= 0) sel.splice(i, 1); else sel.push(v); };
      var barBtn = function (label, fk, onClick, cls, disabled) {
        var b = h('button', { type: 'button', class: cls || '', 'data-fk': fk, text: label, disabled: !!disabled });
        b.addEventListener('click', onClick);
        return b;
      };
      var paintBar = function (got, searching) {
        bar.innerHTML = '';
        var n = sel.length;
        bar.appendChild(h('span', { class: 'pcount', 'aria-live': 'polite', text: n ? n + ' Selected' : 'Pick one or several' }));
        if (searching && got.length > 1) {
          var allOn = got.every(function (it) { return sel.indexOf(it.value) >= 0; });
          bar.appendChild(barBtn(allOn ? 'Deselect All' : 'Select All ' + got.length, 'pick:all', function () {
            got.forEach(function (it) { var on = sel.indexOf(it.value) >= 0; if (allOn ? on : !on) tick(it.value); });
            paint();
          }));
        }
        if (n) bar.appendChild(barBtn('Clear', 'pick:clear', function () { sel.splice(0, sel.length); paint(); }));
        var verb = o.verb || 'Add';
        bar.appendChild(barBtn(n && verb !== 'Next' ? verb + ' ' + n : verb, 'pick:add', function () { o.onDone(sel.slice()); }, 'add', !n));
      };
      var roomOf = function (it) {
        if (it.room !== undefined && it.room !== null) return it.room;
        return client.states[it.value] ? (self.areaName(self.areaOf(it.value)) || '') : null;
      };
      var paint = function () {
        box.innerHTML = '';
        var words = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        var all = o.items(o.tab).map(function (it) {
          var ent = !!client.states[it.value];
          return { value: it.value, label: it.label, room: roomOf(it), note: it.note,
                   // under its room, an entity's second line is its id (two
                   // "Water Heater"s told apart), whatever the caller wrote
                   sub: ent ? it.value : it.sub, icon: it.icon || (ent ? self.accGlyph(it.value) : null) };
        });
        var got = all.filter(function (it) {
          var t = (it.label + ' ' + (it.sub || '') + ' ' + it.value + ' ' + (it.room || '')).toLowerCase();
          return words.every(function (w) { return t.indexOf(w) >= 0; });
        });
        if (bar) paintBar(got, words.length > 0);
        var row = function (it) {
          if (o.multi) {
            var on = sel.indexOf(it.value) >= 0;
            return K.check({ label: it.label, sub: it.sub, multi: true, on: on, icon: it.icon, value: it.note, fk: 'pick:' + it.value,
                             onClick: function () { tick(it.value); paint(); } });
          }
          return K.check({ label: it.label, sub: it.sub, on: it.value === o.current, icon: it.icon, value: it.note, fk: 'pick:' + it.value,
                           onClick: function () { o.onPick(it.value); } });
        };
        var noneRow = o.none && !o.multi && !words.length
          ? K.check({ label: o.none, on: !o.current, onClick: function () { o.onPick(null); }, fk: 'pick:none' }) : null;
        if (noneRow) box.appendChild(K.group({}, [noneRow]));
        var az = function (a, b) { return a.label.localeCompare(b.label); };
        var CAP = 400, shown = 0;
        if (!got.some(function (it) { return it.room; })) {
          // nothing here has a room (calendars, weather services): one list
          box.appendChild(K.group({}, got.sort(az).slice(0, CAP).map(row)));
          shown = Math.min(got.length, CAP);
        } else {
          var by = {}, rooms = [];
          got.forEach(function (it) { var r = it.room || 'No Room'; if (!by[r]) { by[r] = []; rooms.push(r); } by[r].push(it); });
          rooms.sort(function (a, b) { return (a === 'No Room') - (b === 'No Room') || a.localeCompare(b); });
          rooms.forEach(function (r) {
            if (shown >= CAP) return;
            var list = by[r].sort(az).slice(0, CAP - shown);
            shown += list.length;
            box.appendChild(K.group({ header: r }, list.map(row)));
          });
        }
        if (!got.length) box.appendChild(K.group({ footer: 'Nothing matches.' }, []));
        else if (got.length > shown) box.appendChild(K.group({ footer: 'Showing ' + shown + ' of ' + got.length.toLocaleString(window.hkLocale.numTag()) + '. Search to find more.' }, []));
      };
      inp.addEventListener('input', function () { if (o.onQuery) o.onQuery(inp.value); paint(); });
      paint();
    }

    resolve(parts) {
      var hx = this.host();
      if (hx && typeof hx.page === 'function') {
        var hp = hx.page(parts, this);
        if (hp) return hp;
      }
      if (this.hostOnly) return this.rootPage();
      var last = parts[parts.length - 1] || '';
      if (last[0] === '~') return this.pickerPage(parts);
      // AN ADDRESS THAT MOVED (Pages, 2026-10-16) opens where it is now
      var fw = M.routeForward(parts.join('/'));
      if (fw) return this.resolve(fw.split('/'));
      var a = parts[0];
      if (a === 'overview') return this.p_overview();
      if (a === 'page') return parts[1] ? this.p_page(parts[1], parts.slice(2)) : this.p_overview();
      // no screen named: the Overview (the list of screens is the menu) --
      // not "There's no dashboard at /undefined"
      if (a === 'screens') return parts[1] ? this.p_screen(parts[1], parts.slice(2)) : this.p_overview();
      if (a === 'add-screen') return this.p_add(parts.slice(1));
      if (a === 'house' && parts[1] === 'music') return this.p_music(parts.slice(2));    // its old address
      if (a === 'house') return this.p_house(parts[1], parts.slice(2));
      if (a === 'features') {
        if (parts[1] === 'music') return this.p_music(parts.slice(2));
        return F.page(this, parts.slice(1)) || this.p_overview();
      }
      if (a === 'accessories') return this.p_accessories(parts.slice(1));
      if (a === 'popups') return this.p_popups(parts.slice(1));
      if (a === 'pages') return this.p_pages(parts.slice(1));
      if (a === 'chips') return this.p_chips(parts.slice(1));
      if (a === 'advanced') return parts[1] === 'yaml' ? this.p_yamlRef(parts[2]) : this.p_advanced();
      if (a === 'check') return this.p_check();
      if (a === 'setup') return this.p_setup(Number(parts[1] || 0));
      return this.p_overview();
    }

    // ================================================================ PAGES
    // Each: { title, back: [label, hash], top (a sidebar page), scope (html),
    //         preview (a dashboard path), body(container) }

    // ---------------------------------------------------------- overview
    p_overview() {
      var self = this, d = this.data;
      return { title: 'Overview', top: true, scope: 'Settings for the ' + PN() + ' dashboards in this home.', body: function (c) {
        c.appendChild(K.group({ header: 'Where Settings Live' }, [
          K.info({ tile: ['mdi:tablet-dashboard', C.blue], label: 'Screens',
                   sub: 'Each screen’s own menu, Home page, pages, appearance and behavior.' }),
          K.info({ tile: ['mdi:home', C.gray], label: 'All Screens',
                   sub: 'What every screen shares. Where a screen can choose for itself, it says “Same as All Screens” until it does.' }),
          K.info({ tile: ['mdi:file-document-multiple', C.teal], label: 'Pages',
                   sub: 'Each page’s own settings — its header, status row, what’s on it and its background — on one page each: Climate, Security, Energy, Weather …' }),
          K.info({ tile: ['mdi:lightbulb-group', C.yellow], label: 'Accessories',
                   sub: 'Names, icons and rooms: the same on every screen.' })]));
        var check = self._check;
        var bad = check ? check.filter(function (l) { return l.ok === false; }).length : null;
        c.appendChild(K.group({ header: 'Setup' }, [
          K.nav({ label: 'Setup Check', href: '#/check',
                  value: check ? (bad ? bad + ' to Fix' : 'Ready') : 'Checking…' }),
          K.nav({ label: 'Setup Assistant', href: '#/setup' })]));
        c.appendChild(K.group({ header: 'In This Home' }, [
          K.info({ label: 'Screens', value: String(d.dashboards.filter(function (x) { return x.item; }).length) }),
          K.nav({ label: 'Customized Accessories', value: String(Object.keys(d.accessories.entities || {}).length), href: '#/accessories' }),
          K.nav({ label: 'Pop-ups', value: String(d.popups.length), href: '#/popups' }),
          K.nav({ label: 'Custom Pages', value: String((d.custom_pages || []).length), href: '#/pages' })]));
        var hn = self.hostNote('overview');
        if (hn) c.appendChild(K.group({ footer: hn }, []));
        if (!check && !self._checking) {
          self._checking = true;
          self.client.callWS({ type: DOMAIN + '/setup/check' }).then(function (r) {
            self._check = r.lines; self._checking = false; self.render(true);
          }, function () { self._checking = false; });
        }
      } };
    }

    // ---------------------------------------------------------- a screen
    previewCol(path, view) {
      view = view || '0';
      var self = this, x = this.dash(path);
      var col = h('aside', { class: 'pvcol', 'aria-label': 'Preview' });
      var head = h('div', { class: 'pvhead' }, [h('span', { text: 'Preview' }),
        h('a', { href: '/' + path + '/' + view, target: '_blank', rel: 'noopener', text: 'Open Screen' })]);
      // under the host's own address prefix, when it has one (hostScreenBase)
      var mbase = this.hostScreenBase();
      head.lastChild.setAttribute('href', mbase + '/' + path + '/' + view);
      col.appendChild(head);
      var pv = h('div', { class: 'pvbox' });
      var b = (this.data && this.data.boards && this.data.boards[path]) || null;
      var fr = document.createElement('iframe');
      // hk_kiosk=on (HK Frontend's) and kiosk (the Kiosk Mode plugin's): no
      // Home Assistant header or sidebar; wp_enabled=false: WallPanel never
      // runs in a preview (it would drive the real tablet's screensaver)
      fr.src = mbase + '/' + path + '/' + view + '?hk_kiosk=on&kiosk&wp_enabled=false';
      fr.title = (x ? x.title : path) + ' preview';
      fr.setAttribute('tabindex', '-1');
      pv.appendChild(fr);
      col.appendChild(pv);
      // THE SIZE: the screen as a phone, an iPad upright, a wall tablet, a
      // desk -- and a car's browser on a car screen. The frame IS that size
      // (M.previewSizes), drawn scaled to the column; changing it reloads
      // nothing. Opens on the size the screen is used at, then on the last
      // one chosen for it in this browser.
      var sizes = M.previewSizes(b);
      var chosen = null;
      try { chosen = (JSON.parse(localStorage.getItem('hk-preview-size') || '{}') || {})[path]; } catch (e) { /* private */ }
      var key = sizes.some(function (z) { return z.key === chosen; }) ? chosen : M.previewDefault(b);
      var pick = h('div', { class: 'seg pvsize', role: 'radiogroup', 'aria-label': 'Preview size' });
      var dims = h('span', { class: 'pvdim' });
      var btns = sizes.map(function (z, i) {
        var btn = h('button', { type: 'button', role: 'radio', 'data-size': z.key, 'aria-label': z.label, title: z.label }, [
          h('hk-icon', { icon: z.icon, class: z.rotate ? 'rot' : '', 'aria-hidden': 'true' }),
          h('span', { class: 'lb', text: z.label }),
          h('span', { class: 'sh', text: z.short || z.label })]);
        btn.addEventListener('click', function () { choose(z.key); });
        btn.addEventListener('keydown', function (e) {
          var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          var j = (i + d + sizes.length) % sizes.length;
          btns[j].focus();
          choose(sizes[j].key);
        });
        pick.appendChild(btn);
        return btn;
      });
      var fit = function () {
        var z = sizes.filter(function (x) { return x.key === key; })[0] || sizes[0];
        var maxH = self._pvPinned ? Math.max(150, Math.round((window.innerHeight || 800) * 0.28))
          : Math.max(320, Math.min(620, (window.innerHeight || 900) - 300));
        // (the column's own padding is not room for the frame: a pinned preview has some)
        var cs = getComputedStyle(col), cw = col.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        var f = M.previewFit(cw, maxH, z);
        fr.style.width = z.w + 'px';
        fr.style.height = z.h + 'px';
        fr.style.transform = 'scale(' + f.scale + ')';
        pv.style.width = Math.round(f.width) + 'px';
        pv.style.height = Math.round(f.height) + 'px';
        dims.textContent = z.w + ' × ' + z.h + ' · ';
        pick.classList.remove('short');
        pick.classList.toggle('short', btns.some(function (bt) {
          var lb = bt.querySelector('.lb');
          return lb.scrollWidth > lb.clientWidth;
        }));
        btns.forEach(function (bt, i) {
          var on = sizes[i].key === z.key;
          bt.setAttribute('aria-checked', on ? 'true' : 'false');
          bt.setAttribute('tabindex', on ? '0' : '-1');
        });
      };
      function choose(k) {
        if (k === key) return;
        key = k;
        try {
          var all = JSON.parse(localStorage.getItem('hk-preview-size') || '{}') || {};
          all[path] = k;
          localStorage.setItem('hk-preview-size', JSON.stringify(all));
        } catch (e) { /* private: this page only */ }
        fit();
      }
      col.appendChild(pick);
      col.appendChild(h('p', { class: 'gf' }, [dims, document.createTextNode(
        'Live: changes show here within seconds. A generated screen rebuilds itself within about ten.')]));
      requestAnimationFrame(fit);
      new ResizeObserver(fit).observe(col);
      this._pv = { path: path, view: view };
      this._fit = fit;
      void self;
      return col;
    }
    p_screen(path, sub) {
      var self = this, x = this.dash(path);
      var home = [this.title(), '#/'];
      if (!x) return { title: 'Screen', back: home, body: function (c) { c.appendChild(K.group({ footer: 'There’s no dashboard at /' + path + '.' }, [])); } };
      var base = '#/screens/' + encodeURIComponent(path);
      var b = this.data.boards[path];
      if (!x.item || !b) {
        return { title: x.title, top: true, back: home, rename: self.renamable(x), scope: 'This dashboard has no HK settings yet.', body: function (c) {
          c.appendChild(K.group({ footer: 'Give it its own menu, Home page and appearance. It starts from what it’s shown on — a wall tablet, a phone, a computer or a car.' },
            [K.nav({ label: 'Set Up This Screen', href: '#/add-screen/use/' + encodeURIComponent(path), cls: 'tintc' })]));
          if (x.generated && x.mode === 'storage') c.appendChild(self.deleteGroup(x));
        } };
      }
      var s = sub[0];
      var mk = function (title, body, backTo) {
        return { title: title, back: backTo || [x.title, base], preview: path, body: body };
      };
      // A SCREEN'S MENU SETTINGS (Same as All Screens, or its own), and its
      // own button style, narrow-screen choice and highlight
      // EACH DEVICE'S PAGE: its menu (always the screen's own), then its
      // settings -- the screen's own, or a way to All Screens'
      if (s === 'menu' && (sub[1] === 'tablets' || sub[1] === 'phones') && !sub[2]) {
        var dv = sub[1], setD = function (ch) { return self.setB(path, ch); };
        return mk(dv === 'phones' ? 'Phones' : 'Tablets & Computers', function (c) {
          self[dv === 'phones' ? 'menuPhones' : 'menuTablets'](c, b, setD, { base: base + '/menu/' + dv, own: !!b.menu_custom });
        }, ['Menu Settings', base + '/menu']);
      }
      if (s === 'menu' && b.menu_custom && sub[1]) {
        var mb = ['Menu Settings', base + '/menu'];
        var tb = ['Tablets & Computers', base + '/menu/tablets'], pb = ['Phones', base + '/menu/phones'];
        var pickB = function (k, to) {
          return function (v) { var ch = {}; ch[k] = v; self.setB(path, ch); self.back(to || base + '/menu'); };
        };
        if (sub[1] === 'tablets' && sub[2] === 'style') {
          return mk('Button Style', function (c) { self.menuStyle(c, b.menu, pickB('menu', tb[1]), b.swipe); }, tb);
        }
        if (sub[1] === 'phones' && sub[2] === 'style') {
          return mk('Button Style', function (c) { self.phoneStyle(c, M.phoneButton(b), pickB('button_phone', pb[1]), b.swipe); }, pb);
        }
        if (sub[1] === 'accent') return mk('Highlight Color', function (c) { self.menuAccent(c, b.accent, pickB('accent'), self.flatHere(b) ? self.flatScope('screen', x, b) : null); }, mb);
      }
      if (s === 'menu') return mk('Menu Settings', function (c) { self.s_menu(c, x, b); });
      if (s === 'menu-pages' && x.generated) s = 'pages';
      if (s === 'menu-pages') return mk('Pages in Menu', function (c) { self.s_menuPages(c, x, b); });
      if (s === 'chips' && sub[1]) return mk(M.CHIP_LABELS[sub[1]] || sub[1], function (c) { self.s_chip(c, x, b, sub[1]); },
                                               ['Status Chips', base + '/chips']);
      if (s === 'chips') return mk('Status Chips', function (c) { self.s_chips(c, x, b); });
      if (s === 'cameras' && sub[1] === 'live') {
        return mk('Live Camera Follows', function (c) { self.s_cameraLive(c, x, b); }, ['Cameras', base + '/cameras']);
      }
      if (s === 'cameras') return mk('Cameras', function (c) { self.s_cameras(c, x, b); });
      if (s === 'scenes') return mk('Scenes', function (c) { self.s_scenes(c, x, b); });
      if (s === 'favorites') return mk('Favorites', function (c) { self.s_favorites(c, x, b); });
      if (s === 'rooms') return mk('Rooms', function (c) { self.s_rooms(c, x, b); });
      if (s === 'pages') return mk('Pages on This Screen', function (c) { self.s_pages(c, x, b); });
      if (s === 'page-headers') return mk('Page Headers', function (c) { self.s_pageHeaders(c, x, b); });
      if (s === 'sky' && sub[1] === 'backdrop') return mk('Sky Colors', function (c) { self.s_backdrop(c, x, b); }, ['Sky / Background', base + '/sky']);
      if (s === 'sky' && sub[1] === 'landscape') {
        return mk('Choose a Landscape', function (c) {
          self.landscapePick(c, { value: b.sky_landscape || null, house: self.data.settings.sky.landscape || 'every:1440', fk: 'blandpick',
                                  onSet: function (v) { self.setB(x.path, { sky_landscape: v, sky: true }); } });
        }, ['Sky / Background', base + '/sky']);
      }
      if (s === 'sky' && sub[1] === 'pages') return mk('Sky / Background', function (c) { self.s_sky(c, x, b); });
      if (s === 'sky' && sub[1] === 'lively' && sub[2]) {
        var locc = decodeURIComponent(sub[2]);
        return mk(M.livelyOccLabel(locc), function (c) { self.livelyGroup(c, locc, null, { b: b, path: path }); },
                  ['Each Occasion', base + '/sky/lively']);
      }
      if (s === 'sky' && sub[1] === 'lively') {
        return mk('Each Occasion', function (c) { self.livelyList(c, { b: b, path: path, base: base }); }, ['Sky / Background', base + '/sky']);
      }
      if (s === 'sky' && sub[1] === 'page' && sub[2]) {
        var skey = decodeURIComponent(sub[2]);
        var srow = this.skyRow(skey, b), sflat = this.flatHere(b);
        return mk(srow ? srow.label : 'Page', function (c) { if (srow) { if (sflat) self.flatPagePicker(c, x, b, srow, base + '/sky'); else self.pagePicker(c, x, b, srow); } },
                  srow && srow.room ? ['Room Pages', base + '/sky/page/rooms'] : ['Sky / Background', base + '/sky']);
      }
      if (s === 'sky') return mk('Sky / Background', function (c) { self.s_sky(c, x, b); });
      if (s === 'glass') return mk('Appearance Style', function (c) { self.s_glass(c, x, b); });
      if (s === 'flat-colors') return this.p_flatColors('screen', x, b, sub.slice(1), mk, [x.title, base]);
      if (s === 'copy') return mk('Copy Settings', function (c) { self.s_copy(c, x, b); });
      // SLEEP SCREEN is each tablet's since 1.14: a screen's old address opens
      // its (first) tablet's
      if (s === 'sleep') {
        var st0 = (b.tablets || [])[0];
        if (st0 && this.tabs()[st0]) {
          var to = '#/house/tablets/' + encodeURIComponent(st0) + '/sleep' + (sub[1] ? '/' + sub[1] : '');
          try { history.replaceState(null, '', to); } catch (e) { /* no history */ }
          return this.resolve(['house', 'tablets', st0, 'sleep'].concat(sub[1] ? [sub[1]] : []));
        }
        return mk('Sleep Screen', function (c) {
          c.appendChild(K.group({ footer: 'Sleep Screen is each wall tablet’s own. Add the tablet that shows this screen in Wall Tablets.' }, [
            K.nav({ label: 'Wall Tablets', href: '#/house/tablets' })]));
        });
      }
      if (s === 'screensaver' && sub[1] === 'clock-style') {
        var cpg = mk('Clock Style', function (c) { self.saverStyle(c, M.saverOptions(b.screensaver_options), self.saverPutB(path)); },
                     ['Screensaver Options', base + '/screensaver']);
        cpg.saverPreview = true;
        return cpg;
      }
      if (s === 'screensaver' && sub[1] === 'weather') {
        var wpg = mk('Weather', function (c) { self.saverWeather(c, M.saverOptions(b.screensaver_options), self.saverPutB(path)); },
                     ['Screensaver Options', base + '/screensaver']);
        wpg.saverPreview = true; wpg.saverWeather = true;
        return wpg;
      }
      if (s === 'screensaver' && sub[1] === 'energy') {
        var epg = mk('Home Energy', function (c) { self.saverEnergy(c, M.saverOptions(b.screensaver_options), self.saverPutB(path)); },
                     ['Screensaver Options', base + '/screensaver']);
        epg.saverPreview = true; epg.saverEnergy = true;
        return epg;
      }
      if (s === 'screensaver') {
        var spg = mk('Screensaver Options', function (c) { self.saverPage(c, x, b, path); });
        spg.saverPreview = true;         // the frame shows the screensaver itself
        return spg;
      }
      if (s === 'kiosk') return mk('Home Assistant Header & Sidebar', function (c) { self.kioskPage(c, x, b, path); });
      // A THIRD-PARTY CARD'S OPTIONS: WallPanel's, and the Kiosk Mode
      // plugin's (kiosk-mode: a page under Header & Sidebar)
      if (s === 'wallpanel' || s === 'kiosk-mode') {
        var tpk = s === 'kiosk-mode' ? 'kiosk' : s;
        var key = tpk + '_options', spec = OPTION_PAGES[tpk];
        var saveOpts = function (v) { var o = {}; o[key] = v; return self.setB(path, o); };
        if (sub[1] === 'yaml') {
          return mk('Options in YAML', function (c) {
            self.yamlPage(c, { value: b[key] || {}, note: ((self.data.thirdparty || {})[tpk] || {}).note, sk: 'b:' + key,
                               help: spec.yamlHelp, example: spec.example, docs: spec.docs, onSave: saveOpts });
          }, [spec.title, base + '/' + s]);
        }
        return mk(spec.title, function (c) {
          if (s === 'wallpanel') self.engineGroup(c, b, path);
          self.optionsPage(c, spec, b[key] || {}, saveOpts, base + '/' + s + '/yaml', ((self.data.thirdparty || {})[tpk] || {}));
        }, s === 'kiosk-mode' ? ['Header & Sidebar', base + '/kiosk'] : null);
      }
      return { title: x.title, top: true, back: home, preview: path, previewTop: true, rename: this.renamable(x),
        scope: 'Only this screen · <b>/' + K.esc(path) + '</b> · ' + (x.generated ? (self.onlyOf(b) ? 'Generated: ' + K.esc(self.onlyOf(b).text) : 'Generated from your home') : 'Written in YAML'),
        body: function (c) { self.s_main(c, x, b); } };
    }
    s_main(c, x, b) {
      var self = this, path = x.path, base = '#/screens/' + encodeURIComponent(path), gen = x.generated;
      var set = function (ch) { return self.setB(path, ch); };
      var look = this.data.settings.look;
      if (!this.hasAttribute('wide')) {
        c.appendChild(K.group({}, [K.nav({ label: 'Open Screen', sub: 'In a new tab', href: '/' + path + '/0', icon: 'mdi:open-in-new' })]));
        var o = c.lastChild.querySelector('a');
        o.setAttribute('target', '_blank'); o.setAttribute('rel', 'noopener');
      }
      // A SCREEN OF ONLY SOME PAGES: first thing on its page, what it shows
      // and the way back to a whole screen
      var only = gen ? this.onlyOf(b) : null;
      if (only) {
        c.appendChild(K.group({ header: 'This Screen Shows', footer: only.keys.length
            ? 'No Home page and no room pages: only ' + (only.names.length > 2 ? 'these pages' : only.names.join(' and ')) +
              ', opening on ' + only.names[0] + '. Turn it into a whole screen any time; nothing is deleted.'
            : 'Home Page is off but no page is picked yet, so it still shows everything. Pick its pages.' }, [
          K.nav({ label: only.text, sub: only.keys.length > 2 ? only.names.join(', ') : null, icon: 'mdi:file-document-multiple-outline',
                  value: 'Change Pages', href: base + '/pages', fk: 'only:pages' }),
          K.button({ label: 'Make It a Whole Screen', fk: 'only:whole', onClick: function () { self.setHomePage(path, true); } })]));
      }
      // MENU, BY DEVICE (2026-10-08): tablets and computers, and phones --
      // each its own kind of menu; their settings in Menu Settings
      var mode = M.menuMode(b), pmode = M.phoneMenu(b), rows = [];
      rows.push(this.menuKind(b, set, 'tablets', 'Tablets & Computers'));
      rows.push(this.menuKind(b, set, 'phones', 'Phones'));
      if (mode !== 'off' || pmode !== 'off') {
        // its look, button, edge tab and the rest: All Screens' or its own
        rows.push(K.nav({ label: 'Menu Settings', value: M.menuSummary(b), href: base + '/menu', sk: 'b:menu_custom' }));
        // a generated screen says which pages its menu lists on its Pages
        if (!gen) rows.push(K.nav({ label: 'Pages in Menu', sk: 'b:categories', href: base + '/menu-pages',
                                    value: b.categories.length || (b.menu_top || []).length ? 'Custom' : 'Automatic' }));
      }
      c.appendChild(K.group({ header: 'Menu', footer: M.DEVICES.fold }, rows));

      // HOME PAGE
      var chipsVal = !b.chips_row ? 'Off' : b.chips.length ? b.chips.length + ' Chips' : 'Automatic';
      var camsVal = gen && !b.camera_strip ? 'Off' : !b.cameras_custom ? 'Same as All Screens'
        : b.cameras.length ? b.cameras.length + ' Cameras' : 'Automatic';
      var scenesVal = !b.scenes_row ? 'Off' : b.scenes.length ? b.scenes.length + ' Scenes' : 'Automatic';
      var roomsVal = b.rooms_custom ? M.roomsSummary(b) : 'Same as All Screens';
      var home = [
        K.nav({ label: 'Status Chips', value: chipsVal, href: base + '/chips', sk: 'b:chips' }),
        K.nav({ label: 'Cameras', value: camsVal, href: base + '/cameras', sk: 'b:cameras' }),
        K.nav({ label: 'Scenes', value: scenesVal, href: base + '/scenes', sk: 'b:scenes' })];
      if (gen) home.push(K.nav({ label: 'Favorites', value: b.favorites.length ? b.favorites.length + (b.favorites.length === 1 ? ' Favorite' : ' Favorites') : 'None',
                                 href: base + '/favorites', sk: 'b:favorites' }));
      home.push(K.nav({ label: 'Rooms', value: roomsVal, href: base + '/rooms', sk: 'b:rooms_custom' }));
      // only some pages: no Home page to set up here
      if (!only) c.appendChild(K.group({ header: 'Home Page', footer: gen ? null :
        'This screen is written in YAML, so it draws its own Home page. These lists apply where its cards read them: the chip row, the scenes row, the camera strip and the room order.' }, home));

      // PAGES
      if (gen && !only) {
        var hdOff = Object.keys(b.headers || {}).length;
        c.appendChild(K.group({ header: 'Pages', footer: 'The order here is the menu’s too; each page’s row says where it sits in the menu. ' +
            'Each page’s own settings are under Pages in the sidebar; Page Headers turns a page’s header off on this screen alone.' }, [
          K.nav({ label: 'Pages on This Screen', href: base + '/pages', sk: 'b:pages',
                  value: b.pages.length ? b.pages.filter(function (k) { return k !== 'browse'; }).length + ' Pages' : 'Automatic' }),
          K.nav({ label: 'Page Headers', href: base + '/page-headers', sk: 'b:headers',
                  value: hdOff ? hdOff + ' Off' : 'Same as All Screens' })]));
      }

      // THE HEADER (2026-10-09): what sits at the top of Home on a phone, and
      // Home Assistant's own header and sidebar -- every screen, generated or
      // not (hk-kiosk.js), or the Kiosk Mode plugin on a generated one that
      // chooses it
      var hdr = [];
      if (gen) hdr.push(K.seg({ label: 'Header on Phones', sk: 'b:phone_header', stack: !this.hasAttribute('wide'),
                                   value: b.phone_header || 'header', options: [['header', 'Clock & Weather'], ['strip', 'Weather Strip']],
                                   onChange: function (v) { self.setB(path, { phone_header: v }); } }));
      hdr.push(K.nav({ label: 'Home Assistant Header & Sidebar', href: base + '/kiosk', sk: 'b:kiosk', value: M.kioskSummary(b, gen) }));
      var hdrFoot = [];
      if (gen && b.kiosk && b.kiosk_engine === 'kiosk_mode' && (this.data.thirdparty.kiosk || {}).state !== 'ready') {
        hdrFoot.push((this.data.thirdparty.kiosk || {}).note || '');
      }
      if (gen) hdrFoot.unshift('Header on Phones: on a phone held upright, narrower than 640 px.');
      c.appendChild(K.group({ header: 'Header', footer: hdrFoot.join(' ') || null }, hdr));

      // GLASS (2026-10-09): laid out as All Screens' Appearance -- the style,
      // then its own settings (glassRows), the same footer
      var gl = M.glassOf(b, look), app = [];
      app.push(K.nav({ label: 'Appearance Style', href: base + '/glass', sk: 'b:glass',
        sub: gl.own ? 'Just This Screen' : 'Same as All Screens', value: M.glassLabel(gl.own ? gl.value : gl.house) }));
      var amt = function (k) {
        var a = M.amountOf(b, look, k);
        return { value: a.value, own: a.own, house: a.house,
                 onChange: function (v) { var o = {}; o[k] = v; set(o); }, reset: function () { var o = {}; o[k] = null; set(o); } };
      };
      var tOwn = typeof b.frost_tint === 'boolean', tHouse = !!look.frost_tint;
      var wOwn = b.well === 'dark' || b.well === 'light', wHouse = look.well || 'dark';
      app = app.concat(this.glassRows(gl.effective, {
        frost: amt('frost'), blur: amt('blur'), dark: amt('tint'),
        well: { value: wOwn ? b.well : wHouse, own: wOwn, house: wHouse,
                onChange: function (x) { set({ well: x }); }, reset: function () { set({ well: null }); } },
        tint: { on: tOwn ? b.frost_tint : tHouse, own: tOwn, house: tHouse,
                onChange: function (on) { set({ frost_tint: on }); }, reset: function () { set({ frost_tint: null }); } }
      }, 'b:'));
      if (gl.effective === 'flat') {
        app = app.concat(this.flatThemeRows(b, look, x.path));
        var fsc = this.flatScope('screen', x, b), fown = fsc.own();
        app.push(this.flatColorsNav(fsc, { sub: fown.accent != null || fown.off_tint != null ? 'Just This Screen' : 'Same as All Screens' }));
        app.push(K.nav({ label: 'Highlight Color', value: M.accentOf(b.accent).name, href: base + '/menu/accent', sk: 'b:accent',
                         sub: fsc.resolved().accent.value !== 'auto' ? 'In Flat, the Accent Color' : null }));
      }
      c.appendChild(K.group({ header: 'Appearance', footer: M.glassFooter(gl.effective) }, app));
      var skyRows = [];
      // a page screen: what its pages actually show (one page: its background
      // by name), never a "Same as All Screens" that reaches nothing
      var bflat = this.flatHere(b), skyVal = bflat ? this.flatSummary(b) : M.skySummary(b);
      if (only && only.keys.length) {
        var spk = this.skyPageKeys(b);
        var modes = spk.rows.map(function (r) { return self.skyPageLabel(r, b); });
        var same = modes.every(function (m2) { return m2 === modes[0]; });
        skyVal = same ? modes[0] : 'Mixed';
      }
      // the live sky's on/off is the first thing on its page (s_sky)
      // a screen whose Live Sky was turned off (before 2026-10-13) shows Black
      // (Flat's backgrounds are its own: that switch isn't theirs)
      skyRows.push(K.nav({ label: 'Sky / Background', href: base + '/sky', sk: 'b:sky_look', value: b.sky || bflat ? skyVal : 'Black' }));
      c.appendChild(K.group({ header: 'Sky / Background' }, skyRows));

      // BEHAVIOR
      var beh = [K.toggle({ label: 'Allow Pop-ups', sk: 'b:popups', on: b.popups, onChange: function (on) { set({ popups: on }); } })];
      if (gen) {
        beh.push(K.toggle({ label: 'Now Playing', sk: 'b:now_playing', on: b.now_playing,
                            sub: 'The music playing, in a side pane or a bar.',
                            onChange: function (on) { set({ now_playing: on }); } }));
        // ...AND WHERE (2026-10-15): All Screens' Now Playing, or this
        // screen's own -- each a Same as All Screens choice
        if (b.now_playing && b.np_style !== undefined) {
          var hnp = this.npHouse(), lab = function (list, v) { return M.choiceLabel(list, v); };
          var npSel = function (key, label, list, hv) {
            var own = b[key];
            return K.select({ label: label, sk: 'b:' + key, sub: own ? 'Just This Screen' : 'Same as All Screens', value: own || '',
              options: [['', 'Same as All Screens (' + lab(list, hv) + ')', lab(list, hv)]].concat(list),
              onChange: function (v) { var o = {}; o[key] = v || null; set(o); } });
          };
          var effStyle = b.np_style || hnp.style;
          beh.push(npSel('np_style', 'Show As', M.NP_STYLES, hnp.style));
          if (effStyle === 'pane') beh.push(npSel('np_side', 'Pane Side', M.NP_SIDES, hnp.side));
          else beh.push(npSel('np_bar', 'Bar Position', M.NP_BARS, hnp.bar));
          beh.push(npSel('np_bar_phone', 'Bar Position on Phones', M.NP_BARS, hnp.bar_phone));
        }
        // (shown once the integration knows it: an older one would drop it)
        if (b.timer_bar !== undefined) {
          // needs the quick_timers.yaml package (its running-timers sensor): off and dimmed while it is missing
          var qtOn = !!(this.client.states || {})['sensor.running_quick_timers'];
          beh.push(K.toggle({ label: 'Timer Bar', sk: 'b:timer_bar', on: b.timer_bar, disabled: !qtOn && !b.timer_bar,
                              sub: 'Running quick timers, docked along the bottom — over the player when music plays.' +
                                   (qtOn ? '' : ' Needs the quick_timers.yaml package in Home Assistant.'),
                              onChange: function (on) { set({ timer_bar: on }); } }));
        }
        if (b.bar_all_pages !== undefined && (b.now_playing || b.timer_bar)) {
          beh.push(K.toggle({ label: 'On Every Page', sk: 'b:bar_all_pages', on: b.bar_all_pages,
                              sub: 'The bar on every page of this screen, not Home alone.',
                              onChange: function (on) { set({ bar_all_pages: on }); } }));
        }
      }
      var pops = (this.data.popups || []).map(function (p) { return p.name || '#' + p.hash; });
      c.appendChild(K.group({ header: 'Behavior', footer: (pops.length ? 'Pop-ups (' + pops.join(', ') + ')' : 'Pop-ups') +
        ' open over this screen when an automation shows one. Off: never here — a car’s screen, say.' }, beh));

      // NOTIFICATIONS (Features -> Notifications): this screen's switch, its
      // screensaver, its Do Not Disturb -- each Same as All Screens unless set
      if (F.stateOf(this.data.features, 'hk_notify') === 'added') {
        var nd = (this.feat('hk_notify').data || {}).options || {};
        var SAVERS = { all: 'All', important: 'Important Only', off: 'Off' };
        var nrows = [K.toggle({ label: 'Allow Notifications', sk: 'b:notify', on: b.notify !== false,
                                sub: 'Banners from Notifications show on this screen',
                                onChange: function (on) { set({ notify: on }); } })];
        var nwhile = null;
        if (b.notify !== false) {
          var hs = SAVERS[nd.saver] || 'Important Only';
          nrows.push(K.select({ label: 'On the Screensaver', sub: b.notify_saver ? 'Just This Screen' : 'Same as All Screens',
            value: b.notify_saver || '', sk: 'b:notify_saver',
            options: [['', 'Same as All Screens (' + hs + ')', hs], ['all', 'All'], ['important', 'Important Only'], ['off', 'Off']],
            onChange: function (v) { set({ notify_saver: v || null }); } }));
          var dnd = b.notify_dnd, own = !!(dnd && (dnd.schedule || (dnd['while'] || []).length));
          var hd = F.dndSummary(nd.dnd);
          nrows.push(K.select({ label: 'Do Not Disturb', sub: dnd ? 'Just This Screen' : 'Same as All Screens',
            value: !dnd ? '' : own ? 'own' : 'off', sk: 'b:notify_dnd',
            options: [['', 'Same as All Screens (' + hd + ')', hd], ['off', 'Off on This Screen', 'Off'], ['own', 'Its Own Hours']],
            onChange: function (v) {
              set({ notify_dnd: v === '' ? null : v === 'off' ? { schedule: false, 'while': [] }
                : { schedule: true, from: (nd.dnd || {}).from || '22:00', to: (nd.dnd || {}).to || '07:00', 'while': [] } });
            } }));
          if (own) {
            var dr = F.dndRows(this, dnd, function (x) { set({ notify_dnd: x }); }, 'b:notify_dnd');
            nrows = nrows.concat(dr.rows);
            nwhile = dr.whileRows;
          }
        }
        c.appendChild(K.group({ header: 'Notifications', footer: 'Which notifications there are, and All Screens’ choices, are in Notifications. An Important one gets through Do Not Disturb.' }, nrows));
        if (nwhile) c.appendChild(K.group({ header: 'Do Not Disturb While This Is On', footer: 'An input_boolean, a switch, a timer while it runs.' }, nwhile));
      }

      // WHEN IDLE: the photo screensaver -- what it shows is the screen's
      // (an existing dashboard's comes from these settings unless its own
      // YAML has hk_screensaver, hk-saver.js fromSettings; WallPanel for a
      // generated screen only). When it starts, Home and dark are each wall
      // tablet's own (1.14).
      var idle = [K.toggle({ label: 'Photo Screensaver', sk: 'b:screensaver', on: b.screensaver,
                            onChange: function (on) { set({ screensaver: on }); } })];
      if (b.screensaver) {
        var wp = gen && b.screensaver_engine === 'wallpanel';
        idle.push(K.nav({ label: 'Screensaver Options', href: base + (wp ? '/wallpanel' : '/screensaver'),
                          sk: wp ? 'b:wallpanel_options' : 'b:screensaver_options',
                          value: wp ? 'WallPanel' : (M.saverFollows(b) ? 'Same as All Screens' : 'Just This Screen') }));
      }
      var mine = (b.tablets || []).filter(function (tid) { return self.tabs()[tid]; });
      var idf = [];
      if (b.screensaver) {
        idf.push(mine.length ? 'It runs on this screen’s wall tablets (below), never on a desk or a phone opening it.'
          : 'It runs only on a wall tablet: add the tablet that shows this screen, below.');
        if (!gen) idf.push('If this dashboard’s own YAML has an hk_screensaver block, that is used instead.');
      }
      c.appendChild(K.group({ header: 'When Idle', footer: idf.join(' ') || null }, idle));

      // WALL TABLETS (1.14): the tablets that run this screen -- each one's
      // user, room, idle time and Sleep Screen are its own
      var trows = mine.map(function (tid) {
        var tt = self.tabs()[tid], ts = self.tabletStatusOf(tid);
        return K.nav({ tile: ['mdi:tablet', ts.known ? self.tabTile(ts.st) : C.blue], label: tt.name,
                       sub: M.tabletApp(tt.app)[1], href: '#/house/tablets/' + encodeURIComponent(tid), fk: 'b:tab:' + tid,
                       value: !ts.known ? '' : ts.st === 'off' ? 'Offline' : ts.word + (ts.batt !== null ? ' · ' + ts.batt + '%' : '') });
      });
      var addT = K.nav({ tile: ['mdi:plus', C.gray], label: 'Add a Tablet to This Screen…', href: '#/house/tablets/add', sk: 'b:tablets' });
      addT.addEventListener('click', function () { self._newT = null; self._addScreen = path; });
      trows.push(addT);
      c.appendChild(K.group({ header: 'Wall Tablets', footer: 'The tablets that run this screen. Each one’s user, room, idle time and Sleep Screen are its own, in Wall Tablets.' }, trows));

      // THIS DEVICE: a car's browser -- and, in one, which Home the screen
      // generates (M.CAR_LAYOUTS) and how much layout its window holds
      // (M.CAR_WIDTHS: tesla-viewport.js zooms to it; Custom, any width)
      var carRows = [K.toggle({ label: 'Car Browser', sub: 'Fit a car’s narrow browser to a desktop layout.', sk: 'b:car', on: b.car,
                                onChange: function (on) { set({ car: on }); } })];
      var carFoot = null;
      if (b.car) {
        var cl = b.car_layout === 'car' ? 'car' : 'home';
        carRows.push(K.select({ label: 'Car Layout', sk: 'b:car_layout', value: cl,
          options: M.CAR_LAYOUTS.map(function (o) { return [o[0], o[1]]; }),
          onChange: function (v) { set({ car_layout: v }); } }));
        this._carCustom = this._carCustom || {};
        var cw = M.carWidthChoice(b.car_width, this._carCustom[path]);
        carRows.push(K.select({ label: 'Scale', sk: 'b:car_width', value: cw, options: M.CAR_WIDTHS,
          onChange: function (v) {
            self._carCustom[path] = v === 'custom';
            if (v === 'custom') { self.render(); return; }
            set({ car_width: v ? Number(v) : null });
          } }));
        if (cw === 'custom') {
          carRows.push(K.text({ label: 'Layout Width', sk: 'b:car_width:n', value: b.car_width || M.CAR_WIDTH, unit: 'px', inputmode: 'numeric',
            error: this.err('b:car_width'),
            onCommit: function (t) { set({ car_width: Number(String(t).replace(/[^\d.]/g, '')) || null }); } }));
        }
        carFoot = M.CAR_LAYOUTS.filter(function (o) { return o[0] === cl; })[0][2] +
          ' Scale: how much of a desktop layout the car’s window holds — Larger shows less of it, bigger; ' +
          'Custom takes a width of your own (Standard is ' + M.CAR_WIDTH.toLocaleString(window.hkLocale.numTag()) + ' px).';
      }
      c.appendChild(K.group({ header: 'This Device', footer: carFoot }, carRows));

      // THE HOST'S OWN, for this screen (extend, above): nothing in Home Assistant
      var hx = this.host();
      if (hx && typeof hx.extend === 'function') {
        try { hx.extend('screen', c, { screen: path, title: x.title, where: x.where || null }, this); } catch (e) { /* the host's own page */ }
      }

      c.appendChild(K.group({ footer: 'Another screen’s menu, Home page, appearance and more, onto this one — you choose which.' }, [
        K.nav({ label: 'Copy Settings From…', href: base + '/copy', sk: 'b:copy' })]));
      if (!gen) c.appendChild(K.group({ footer: 'What this dashboard’s own YAML can say beyond these settings: the live sky, HK cards, ' +
          'rooms in the menu, and more, ready to copy.' }, [K.nav({ label: 'YAML Reference', href: '#/advanced/yaml', sk: 'b:yaml-ref' })]));
      if (gen && x.mode === 'storage') { c.appendChild(this.deleteGroup(x)); return; }
      // a host that can't remove a screen's settings says why instead
      if (this.hostNote('screen_remove')) {
        c.appendChild(K.group({ footer: this.hostNote('screen_remove') }, []));
        return;
      }
      c.appendChild(K.group({ footer: 'The dashboard itself stays. Its menu, Home page and appearance go back to the defaults.' }, [
        K.button({ label: 'Remove HK Settings…', destructive: true, sk: 'b:remove', onClick: function () {
          K.confirm(self.shadowRoot, { title: 'Remove HK settings for ' + x.title + '?',
            message: 'The dashboard stays. Its menu, Home page, pages and appearance go back to the defaults.',
            ok: 'Remove', destructive: true }).then(function (yes) {
            if (!yes) return;
            self.ws({ type: 'config_entries/subentries/delete', entry_id: self.data.entry_id, subentry_id: x.item })
              .then(function (ok) { if (ok) self.reload().then(function () { self.render(); }); });
          });
        } })]));
    }
    // COPY SETTINGS FROM ANOTHER SCREEN onto this one: which screen, which
    // parts (M.COPY_GROUPS; Favorites and Scenes are left unticked), then one
    // save. A screen's own tablet (Tablet User, Tablet Room) never travels.
    s_copy(c, x, b) {
      var self = this, path = x.path;
      var st = this._copy = (this._copy && this._copy.to === path) ? this._copy : { to: path, from: null, groups: M.copyDefaults() };
      var from = (this.data.dashboards || []).filter(function (d) { return d.item && d.path !== path && self.data.boards[d.path]; });
      if (!from.length) {
        c.appendChild(K.group({ footer: 'There is no other screen with HK settings to copy from yet.' }, []));
        return;
      }
      c.appendChild(K.group({ header: 'From', footer: 'Its settings as they are now; nothing on that screen changes.' }, from.map(function (d) {
        return K.check({ label: d.title, sub: '/' + d.path, on: st.from === d.path, fk: 'copy:from:' + d.path,
                         onClick: function () { st.from = d.path; self.render(); } });
      })));
      this.copyGroups(c, st);
      var src = st.from && this.data.boards[st.from];
      var fromTitle = st.from ? ((this.dash(st.from) || {}).title || st.from) : '';
      c.appendChild(K.group({ footer: 'This screen’s Tablet User and Tablet Room are kept: they belong to its tablet.' }, [
        K.button({ label: st.from ? 'Copy to ' + x.title + '…' : 'Choose a Screen to Copy From', center: true, fk: 'copy:go',
                   disabled: !st.from || !st.groups.length, onClick: function () {
          var names = M.COPY_GROUPS.filter(function (g) { return st.groups.indexOf(g[0]) >= 0; }).map(function (g) { return g[1]; });
          K.confirm(self.shadowRoot, { title: 'Copy from ' + fromTitle + '?', ok: 'Copy',
                                       message: names.join(', ') + ' on ' + x.title + ' are replaced with ' + fromTitle + '’s.' }).then(function (yes) {
            if (!yes) return;
            self.setB(path, M.copyChanges(src, st.groups)).then(function () {
              self._copy = null;
              self.announce('Copied from ' + fromTitle + '.');
              self.back('#/screens/' + encodeURIComponent(path));
            });
          });
        } })]));
    }
    copyGroups(c, st) {
      var self = this;
      c.appendChild(K.group({ header: 'What to Copy', footer: 'Favorites and scenes are usually a screen’s own, so they start unticked.' },
        M.COPY_GROUPS.map(function (g) {
          var on = st.groups.indexOf(g[0]) >= 0;
          return K.check({ label: g[1], multi: true, on: on, fk: 'copy:g:' + g[0], onClick: function () {
            st.groups = on ? st.groups.filter(function (k) { return k !== g[0]; }) : st.groups.concat([g[0]]);
            self.render();
          } });
        })));
    }
    // DELETE SCREEN: a generated screen -- one the page can make -- can go
    // altogether: its dashboard and its settings. A hand-written one only
    // ever loses its settings (Remove HK Settings): it is a file.
    deleteGroup(x) {
      var self = this;
      return K.group({ footer: 'Deletes the dashboard and its HK settings. A tablet showing it will need another screen.' }, [
        K.button({ label: 'Delete Screen…', destructive: true, sk: 'b:delete', onClick: function () {
          K.confirm(self.shadowRoot, { title: 'Delete ' + x.title + '?',
            message: 'The dashboard /' + x.path + ' and its HK settings are deleted. This can’t be undone here.',
            ok: 'Delete', destructive: true }).then(function (yes) { if (yes) self.deleteScreen(x); });
        } })]);
    }
    async deleteScreen(x) {
      // the preview is that dashboard, running: unload it first, or it
      // reports its own dashboard missing the moment it is deleted
      var pv = this.pageEl.querySelector('.pvcol');
      if (pv) { var fr = pv.querySelector('iframe'); if (fr) fr.src = 'about:blank'; pv.remove(); }
      this._pv = null; this._fit = null;
      this.status('saving');
      try {
        if (x.item) await this.actions().callWS({ type: 'config_entries/subentries/delete', entry_id: this.data.entry_id, subentry_id: x.item });
        var list = await this.client.callWS({ type: 'lovelace/dashboards/list' });
        var d = (list || []).filter(function (y) { return y.url_path === x.path; })[0];
        if (d) await this.actions().callWS({ type: 'lovelace/dashboards/delete', dashboard_id: d.id });
        this.status('saved');
        this.announce(x.title + ' deleted');
      } catch (e) {
        this.status('error');
        this.announce('Couldn’t delete it: ' + ((e && e.message) || e));
      }
      await this.reload();
      this.go('#/overview');
    }
    s_menuPages(c, x, b) {
      // A HAND-WRITTEN SCREEN'S MENU: each of its pages at the top
      // (right under Home), under Categories, or not in the menu -- as a
      // generated screen's Pages does it. Automatic: the views' own `menu: top`
      // at the top; under Categories, the pages Home's status chips open.
      var self = this, set = function (ch) { return self.setB(x.path, ch); };
      var items = (x.menu_layout || []).map(function (it) { return { path: it.path, title: it.title, page: it.page, top: it.top, auto: it.auto }; });
      if (!items.length) { c.appendChild(K.group({ footer: 'This dashboard has no pages to list besides Home and its rooms.' }, [])); return; }
      c.appendChild(K.group({ footer: 'Top of Menu: right under Home, above Categories. Categories are listed in the order of Home’s status chips. Not in Menu: still one tap away on its chip.' },
        items.map(function (it) {
          return K.select({ label: it.title, sub: it.page ? 'The ' + it.page + ' page' : null, sk: 'place:' + it.path,
            value: M.placeOf(b, it, items), options: M.MENU_PLACES,
            onChange: function (v) {
              var ch = M.placeSet(b, items, it.path, v);
              if (!ch) { self.announce('Categories keeps at least one page: move it to the top, or use the automatic menu.'); self.render(); return; }
              set(ch);
            } });
        })));
      if ((b.menu_top || []).length || (b.categories || []).length) {
        c.appendChild(K.group({ footer: 'Automatic: the pages whose YAML says menu: top at the top; under Categories, the pages Home’s status chips open.' }, [
          K.button({ label: 'Reset to Automatic Menu', fk: 'menu:auto', onClick: function () { set({ menu_top: [], categories: [] }); } })]));
      }
    }
    // A SCREEN'S MENU SETTINGS: Same as All Screens (what they are, each a
    // way to All Screens' Menu), or its own -- the same rows as All Screens'
    s_menu(c, x, b) {
      var self = this, path = x.path, base = '#/screens/' + encodeURIComponent(path);
      var set = function (ch) { return self.setB(path, ch); };
      var mode = M.menuMode(b);
      c.appendChild(K.group({ footer: b.menu_custom
          ? 'This screen’s own menu settings. Turn Same as All Screens back on to follow All Screens again.'
          : 'This screen’s menu follows All Screens → Menu. Turn this off to set its own; it starts as it is now.' }, [
        K.toggle({ label: 'Same as All Screens', sk: 'b:menu_custom', on: !b.menu_custom,
                   onChange: function (on) { set(on ? { menu_custom: false } : M.menuOwnChanges(b)); } })]));
      if (b.menu_custom) { this.menuRows(c, b, set, { base: base + '/menu' }); return; }
      // FOLLOWING ALL SCREENS: each device's menu (the screen's own), then
      // what All Screens' settings are, each row All Screens' own page
      c.appendChild(this.deviceRows(b, base + '/menu', false));
      var side = mode === 'button' || mode === 'open' || M.phoneMenu(b) === 'button', rows = [
        K.info({ label: 'Page Header', value: M.choiceLabel(M.PAGE_HEADERS, b.page_header || 'current'), sk: 'b:page_header' }),
        K.info({ label: 'Highlight Color', value: M.accentOf(b.accent).name, tile: ['', M.accentOf(b.accent).hex], sk: 'b:accent' })];
      if (side) {
        rows.push(K.info({ label: 'Button Icon', value: b.glyph === 'lines' ? 'Three Lines' : 'Sidebar', sk: 'b:glyph' }));
        rows.push(K.info({ label: 'Swipe from Left Edge', value: b.swipe ? 'On' : 'Off', sk: 'b:swipe' }));
        rows.push(K.info({ label: 'Tap Clock to Open Menu', value: b.clock !== false ? 'On' : 'Off', sk: 'b:clock' }));
      }
      if (M.showsTab(b)) rows.push(K.info({ label: 'Edge Tab Position', value: M.tabPosLabel(b.tab_position), sk: 'b:tab_position' }));
      if (M.hasTabBar(b)) {
        rows.push(K.info({ label: 'Tab Bar Position', value: M.choiceLabel(M.TAB_BAR_POS, b.tab_bar_pos || 'bottom'), sk: 'b:tab_bar_pos' }));
        rows.push(K.info({ label: 'Tab Bar Size', value: M.choiceLabel(M.TAB_BAR_SIZES, b.tab_bar_size || 'medium'), sk: 'b:tab_bar_size' }));
        rows.push(K.info({ label: 'Tab Bar Glass', value: M.choiceLabel(M.TAB_BAR_GLASS, b.tab_bar_glass || 'house'), sk: 'b:tab_bar_glass' }));
      }
      rows.push(K.info({ label: 'Home Assistant Section', value: b.ha_row ? M.choiceLabel(M.HA_PLACES, b.ha_place || 'rooms') : 'Off', sk: 'b:ha_row' }));
      this.fromAllScreens(c, rows, 'Menu', '#/house/menu');
    }
    // A SCREEN THAT FOLLOWS ALL SCREENS: what it takes from them, in place,
    // then the one way to change them -- the same on every page (Menu,
    // each device, Rooms)
    fromAllScreens(c, rows, page, href) {
      c.appendChild(K.group({ header: 'From All Screens', footer: 'Change these in All Screens → ' + page +
          ': they change on every screen that follows it. To set this screen’s own, turn off Same as All Screens.' },
        rows.concat([K.nav({ label: 'All Screens → ' + page, href: href, fk: 'from-all:' + href })])));
    }
    // THE MENU'S SETTINGS, for All Screens (o.house: every row, each kind of
    // menu) or one screen's own: BY DEVICE first -- Tablets & Computers and
    // Phones, each a page of its own menu's settings (menuTablets,
    // menuPhones) -- then what every screen size shares. `v` in a screen's
    // keys (M.MENU_KEYS); `set` takes a screen's keys.
    menuRows(c, v, set, o) {
      var self = this, wide = this.hasAttribute('wide');
      var sk = function (k) { return o.house ? 'menu.' + M.MENU_KEYS[k] : 'b:' + k; };
      var tm = M.menuMode(v), pm = M.phoneMenu(v);
      c.appendChild(this.deviceRows(v, o.base, o.house));
      c.appendChild(K.group({ header: 'Page Header', footer: 'With the left menu open or a tab bar, Context When Needed removes a repeated title and keeps a compact label for other pages. No Header removes both Back and title. The full header returns when navigation folds into a button; Music browsing keeps its Back control.' }, [
        K.select({ label: 'Page Header', sk: sk('page_header'), value: v.page_header || 'current', options: M.PAGE_HEADERS,
          onChange: function (value) { set({ page_header: value }); } })]));
      // a side menu somewhere: a button, or always open (a button folded)
      var side = o.house || tm === 'button' || tm === 'open' || pm === 'button';
      var ac = M.accentOf(v.accent);
      var look = [
        K.nav({ label: 'Highlight Color', value: ac.name, href: o.base + '/accent', sk: sk('accent'),
                tile: ['', ac.auto ? AUTO_ACCENT_TILE : ac.hex] })];
      if (side) look.push(K.seg({ label: 'Button Icon', sk: sk('glyph'), value: v.glyph || 'sidebar', stack: !wide,
                options: [['sidebar', 'Sidebar'], ['lines', 'Three Lines']],
                onChange: function (g) { set({ glyph: g }); } }));
      c.appendChild(K.group({ header: 'Look', footer: 'The highlight colors the menu’s icons and the page you’re on.' }, look));
      if (side) {
        // THE OTHER WAYS IN, beside whatever button there is: each on or off
        // on its own (the chip and the tab are one choice -- the tab can
        // wait for the chip to scroll away -- so they stay the Button Style)
        c.appendChild(K.group({ header: 'Other Ways to Open', footer: 'These work alongside the button, and on an always-open ' +
            'menu once it folds away. With the swipe on, a Button Style can be No Button.' }, [
          K.toggle({ label: 'Swipe from Left Edge', sk: sk('swipe'), on: !!v.swipe,
            sub: 'Drag right from the left edge of the screen, at any width. In the Home Assistant app, set its own ' +
                 'Swipe Right gesture to None (Settings → Companion App → Gestures).',
            onChange: function (on) { set(M.swipeChanges(on, v)); } }),
          K.toggle({ label: 'Tap Clock to Open Menu', sub: 'The weather beside it still opens Weather.', sk: sk('clock'),
                     on: v.clock !== false, onChange: function (on) { set({ clock: on }); } })]));
      }
      if (o.house || M.showsTab(v)) this.tabPosRows(c, v, set, sk, o.house);
      if (o.house || M.hasTabBar(v)) this.tabBarShared(c, v, set, sk, o.house);
      this.haRows(c, v, set, sk, o.house);
    }
    // A SCREEN'S MENU ON ONE DEVICE (`device` 'tablets' or 'phones'): always
    // the screen's own. Changing the tablets' writes the phones' down first,
    // so phones keep what they show.
    menuKind(b, set, device, label) {
      var self = this, wide = this.hasAttribute('wide');
      if (device === 'phones') {
        return K.seg({ label: label, sk: 'b:menu_phone', value: M.phoneMenu(b), stack: !wide, options: M.PHONE_MENUS,
                       onChange: function (v) { set({ menu_phone: v }); } });
      }
      var mode = M.menuMode(b);
      if (mode === 'button') this._lastStyle = b.menu;
      return K.seg({ label: label, sk: 'b:menu', value: mode, stack: !wide,
        options: [['off', 'Off'], ['button', 'Button'], ['open', 'Always Open'], ['tabbar', 'Tab Bar']],
        onChange: function (v) {
          var ch = { menu: M.menuFor(v, b, self._lastStyle) };
          if (!b.menu_phone) ch.menu_phone = M.phoneMenu(b);
          set(ch);
        } });
    }
    // THE TWO DEVICES' ROWS at the top of Menu Settings: a screen's say its
    // menu on each, All Screens' the style each follows
    deviceRows(v, base, house) {
      return K.group({ header: 'By Device', footer: house ? 'Each screen chooses its own menu on each.' : null }, [
        K.nav({ label: 'Tablets & Computers', icon: 'mdi:tablet', value: M.tabletSummary(v, house), href: base + '/tablets',
                sk: house ? 'menu:tablets' : 'b:menu' }),
        K.nav({ label: 'Phones', icon: 'mdi:cellphone', value: M.phoneSummary(v, house), href: base + '/phones',
                sk: house ? 'menu:phones' : 'b:menu_phone' })]);
    }
    // A SCREEN'S DEVICE PAGE, its top: the menu on that device, then -- for
    // a screen following All Screens -- the way to All Screens' settings.
    // False: nothing more to show (no menu, or All Screens' settings).
    deviceHead(c, v, set, device, o, kind) {
      var ph = device === 'phones';
      c.appendChild(K.group({ footer: ph ? M.DEVICES.phones + ' Also a tablet whose own menu doesn’t fit.' : M.DEVICES.tablets },
        [this.menuKind(v, set, device, 'Menu')]));
      if (kind === 'off') return false;
      if (o.own) return true;
      this.fromAllScreens(c, this.deviceInfo(v, device), 'Menu → ' + (ph ? 'Phones' : 'Tablets & Computers'), '#/house/menu/' + device);
      return false;
    }
    // ONE DEVICE'S SETTINGS AS A SCREEN TAKES THEM FROM ALL SCREENS (info rows)
    deviceInfo(v, device) {
      var rows = [], I = function (label, value, k) { rows.push(K.info({ label: label, value: value, sk: 'b:' + k })); };
      if (device === 'phones') {
        var pm = M.phoneMenu(v);
        if (pm === 'button') I('Button Style', M.phoneStyleLabel(M.phoneButton(v)), 'button_phone');
        if (M.phoneTab(v)) I('Edge Tab Size', M.choiceLabel(M.TAB_SIZES, v.tab_size_phone || 'standard'), 'tab_size_phone');
        if (pm === 'tabbar') {
          I('While Scrolling', M.choiceLabel(M.TAB_BAR_SCROLLS, v.tab_bar_scroll_phone || 'shrink'), 'tab_bar_scroll_phone');
          I('More Style', M.choiceLabel(M.TAB_BAR_MORE, v.tab_bar_more_phone || 'list'), 'tab_bar_more_phone');
          I('Rooms', M.choiceLabel(M.TAB_BAR_ROOMS, M.roomsPlace(v.tab_bar_rooms_phone)), 'tab_bar_rooms_phone');
        }
        return rows;
      }
      var tm = M.menuMode(v);
      if (tm === 'button') I('Button Style', M.menuStyleLabel(v.menu), 'menu');
      if (tm === 'open') {
        I('Keep Open Down To', v.dock_min + ' px', 'dock_min');
        I('Time & Weather in Menu', v.time_weather === 'menu' ? 'On' : 'Off', 'time_weather');
      }
      if (M.tabletTab(v)) I('Edge Tab Size', M.choiceLabel(M.TAB_SIZES, v.tab_size || 'large'), 'tab_size');
      if (tm === 'tabbar') {
        I('While Scrolling', M.choiceLabel(M.TAB_BAR_SCROLLS, v.tab_bar_scroll || 'shrink'), 'tab_bar_scroll');
        I('Tabs in Bar', String(v.tab_bar_tabs || 6), 'tab_bar_tabs');
        I('Tabs in Rail', String(v.tab_bar_tabs_rail || 6), 'tab_bar_tabs_rail');
        I('More Style', M.choiceLabel(M.TAB_BAR_MORE, v.tab_bar_more || 'icons'), 'tab_bar_more');
        I('Rooms', M.choiceLabel(M.TAB_BAR_ROOMS, M.roomsPlace(v.tab_bar_rooms)), 'tab_bar_rooms');
      }
      return rows;
    }
    // ALL SCREENS' DEVICE PAGE, its top: every screen's menu on that device,
    // each a way to that screen's own page for it
    deviceScreens(c, device) {
      var self = this, bd = this.data.boards || {}, rows = [];
      Object.keys(bd).forEach(function (p) {
        var b = bd[p], d = self.dash(p);
        if (!b) return;
        rows.push(K.nav({ label: d ? d.title : p, value: device === 'phones' ? M.phoneSummary(b) : M.tabletSummary(b),
                          href: '#/screens/' + encodeURIComponent(p) + '/menu/' + device, fk: 'menu:' + device + ':' + p }));
      });
      if (rows.length) {
        c.appendChild(K.group({ header: 'Menu on Each Screen', footer: 'Each screen chooses its own menu on ' +
            (device === 'phones' ? 'phones' : 'tablets and computers') + '. Tap one to change it. The settings below are for every screen that follows All Screens.' }, rows));
      }
    }
    // TABLETS & COMPUTERS: the screen's menu's own settings (All Screens':
    // every kind's) -- a button, always open, the tab bar. Where the menu
    // doesn't fit, the screen shows its Phones menu (hk-base.js phoneForm).
    menuTablets(c, v, set, o) {
      var self = this, wide = this.hasAttribute('wide');
      var sk = function (k) { return o.house ? 'menu.' + M.MENU_KEYS[k] : 'b:' + k; };
      var tm = M.menuMode(v);
      if (o.house) this.deviceScreens(c, 'tablets');
      else if (!this.deviceHead(c, v, set, 'tablets', o, tm)) return;
      if (o.house || tm === 'button') {
        c.appendChild(K.group({ header: 'Menu Button', footer: (o.house ? 'For a screen whose menu is a button. ' : '') +
            'Below 1,024 px — an iPad held upright, Split View — the edge tab has no room beside the page, so the screen ' +
            'shows its Phones menu there.' }, [
          K.nav({ label: 'Button Style', value: M.menuStyleLabel(v.menu), href: o.base + '/style', sk: sk('menu') })]));
      }
      if (o.house || tm === 'open') {
        c.appendChild(K.group({ header: 'Always Open', footer: (o.house ? 'For a screen whose menu is always open beside the page. ' : '') +
            'Narrower than Keep Open Down To — an iPad held upright, Split View — the menu folds away and the screen shows ' +
            'its Phones menu instead.' }, [
          K.text({ label: 'Keep Open Down To', sk: sk('dock_min'), value: v.dock_min, unit: 'px', inputmode: 'numeric',
                   error: this.err(sk('dock_min')), onCommit: function (t) { set({ dock_min: Number(String(t).replace(/[^\d.]/g, '')) || 0 }); } }),
          K.toggle({ label: 'Time & Weather in Menu', sk: sk('time_weather'), on: v.time_weather === 'menu',
                     onChange: function (on) { set({ time_weather: on ? 'menu' : 'page' }); } })]));
      }
      if (o.house || M.tabletTab(v)) {
        c.appendChild(K.group({ header: 'Edge Tab', footer: 'Its position is on ' + (o.house ? 'Menu' : 'Menu Settings') + ', for every device.' }, [
          K.seg({ label: 'Size', sk: sk('tab_size'), value: v.tab_size || 'large', stack: !wide, options: M.TAB_SIZES,
                  onChange: function (z) { set({ tab_size: z }); } })]));
      }
      if (o.house || M.tabletTabBar(v)) {
        c.appendChild(K.group({ header: 'Tab Bar', footer: (o.house ? 'For a screen whose menu is the tab bar. ' : '') +
            'Shrink folds the bar into one small button as you scroll down; Hide slides it off its edge. Scrolling up, either end ' +
            'of the page or a tap brings it back.' }, [
          K.seg({ label: 'While Scrolling', sk: sk('tab_bar_scroll'), value: v.tab_bar_scroll || 'shrink', stack: !wide,
                  options: M.TAB_BAR_SCROLLS, onChange: function (x) { set({ tab_bar_scroll: x }); } }),
          K.select({ label: 'Tabs in Bar', sub: 'Pages at the bottom or the top, besides Home and More.',
                     sk: sk('tab_bar_tabs'), value: String(v.tab_bar_tabs || 6), options: M.TAB_BAR_TABS.map(function (t) { return [String(t[0]), t[1]]; }),
                     onChange: function (x) { set({ tab_bar_tabs: Number(x) }); } }),
          K.select({ label: 'Tabs in Rail', sub: 'Pages down the left or the right, besides Home and More.',
                     sk: sk('tab_bar_tabs_rail'), value: String(v.tab_bar_tabs_rail || 6), options: M.TAB_BAR_TABS.map(function (t) { return [String(t[0]), t[1]]; }),
                     onChange: function (x) { set({ tab_bar_tabs_rail: Number(x) }); } })]));
        this.moreRows(c, v, set, sk, 'tablets');
      }
    }
    // PHONES: the screen's Phones menu's own settings (All Screens': each
    // kind's) -- a button or the tab bar. Also where a tablet's own menu
    // doesn't fit (hk-base.js phoneForm).
    menuPhones(c, v, set, o) {
      var self = this, wide = this.hasAttribute('wide');
      var sk = function (k) { return o.house ? 'menu.' + M.MENU_KEYS[k] : 'b:' + k; };
      var pm = M.phoneMenu(v);
      if (o.house) this.deviceScreens(c, 'phones');
      else if (!this.deviceHead(c, v, set, 'phones', o, pm)) return;
      if (o.house || pm === 'button') {
        c.appendChild(K.group({ header: 'Menu Button', footer: (o.house ? 'For a screen whose Phones menu is a button. ' : '') +
            'The menu slides in over the page.' }, [
          K.nav({ label: 'Button Style', value: M.phoneStyleLabel(M.phoneButton(v)), href: o.base + '/style', sk: sk('button_phone') })]));
      }
      if (o.house || M.phoneTab(v)) {
        c.appendChild(K.group({ header: 'Edge Tab', footer: 'On a phone the tab lies over the first column of tiles. Its position is on ' +
            (o.house ? 'Menu' : 'Menu Settings') + ', for every device.' }, [
          K.seg({ label: 'Size', sk: sk('tab_size_phone'), value: v.tab_size_phone || 'standard', stack: !wide, options: M.TAB_SIZES,
                  onChange: function (z) { set({ tab_size_phone: z }); } })]));
      }
      if (o.house || pm === 'tabbar') {
        c.appendChild(K.group({ header: 'Tab Bar', footer: (o.house ? 'For a screen whose Phones menu is the tab bar. ' : '') +
            'On a phone the bar shows up to three pages besides Home and More, and stays at the bottom when its position is Left or Right.' }, [
          K.seg({ label: 'While Scrolling', sk: sk('tab_bar_scroll_phone'), value: v.tab_bar_scroll_phone || 'shrink', stack: !wide,
                  options: M.TAB_BAR_SCROLLS, onChange: function (x) { set({ tab_bar_scroll_phone: x }); } })]));
        this.moreRows(c, v, set, sk, 'phones');
      }
    }
    // MORE, each device's own: its style and where the rooms are
    moreRows(c, v, set, sk, device) {
      var wide = this.hasAttribute('wide'), ph = device === 'phones';
      var styleKey = ph ? 'tab_bar_more_phone' : 'tab_bar_more', roomsKey = ph ? 'tab_bar_rooms_phone' : 'tab_bar_rooms';
      c.appendChild(K.group({ header: 'More', footer: 'Icons: a grid, as wide as the screen allows. List: rows like the side menu. ' +
          'In More: the rooms under the pages in More. Own Button: a round button beside the bar.' }, [
        K.seg({ label: 'More Style', sk: sk(styleKey), value: v[styleKey] || (ph ? 'list' : 'icons'), stack: !wide,
                options: M.TAB_BAR_MORE, onChange: function (x) { var ch = {}; ch[styleKey] = x; set(ch); } }),
        K.seg({ label: 'Rooms', sk: sk(roomsKey), value: M.roomsPlace(v[roomsKey]), stack: !wide,
                options: M.TAB_BAR_ROOMS, onChange: function (x) { var ch = {}; ch[roomsKey] = x; set(ch); } })]));
    }
    // THE EDGE TAB'S PLACE, on every screen size that shows it
    tabPosRows(c, v, set, sk, house) {
      var self = this, wide = this.hasAttribute('wide');
      var tp = M.tabPosParts(v.tab_position), unit = tp.unit;
      // px <-> % at a wall tablet's 800 px, so the tab stays about where it was
      var conv = function (n, to) { var x = Number(n) || 0; return to === '%' ? Math.round(x / 8) : Math.round(x * 8); };
      var trows = [K.seg({ label: 'Position', sk: sk('tab_position'), value: tp.mode, stack: !wide,
        options: [['date', 'Level with Date'], ['custom', 'Custom']],
        onChange: function (m) { set({ tab_position: m === 'date' ? '' : '120px' }); } })];
      if (tp.mode === 'custom') {
        trows.push(K.text({ label: 'Distance from Top', sub: 'Where the middle of the tab sits.', sk: sk('tab_position') + ':n',
          value: tp.n, unit: unit === '%' ? '%' : 'px', inputmode: 'decimal', error: this.err(sk('tab_position')),
          onCommit: function (t) {
            // a number (px or %), or nothing changes: an empty or wordy box
            // is not a way back to Level with Date -- that has its own button
            var ek = sk('tab_position');
            if (!/^\s*\d+(\.\d+)?\s*(px|%)?\s*$/.test(String(t))) { self.errors[ek] = M.errorText('tab_position'); self.render(); return; }
            delete self.errors[ek];
            set({ tab_position: M.tabPosJoin(t, unit) });
          } }));
        trows.push(K.seg({ label: 'Measured In', sk: sk('tab_position') + ':u', value: unit, stack: !wide,
          options: [['px', 'Pixels'], ['%', '% of Screen Height']],
          onChange: function (u) { if (u !== unit) set({ tab_position: M.tabPosJoin(conv(tp.n, u), u) }); } }));
      }
      c.appendChild(K.group({ header: 'Edge Tab', footer: (house ? 'For a screen that shows the edge tab. ' : '') +
          'Level with Date lines the tab up with the date under the clock. Custom places it a distance from the top, in pixels ' +
          'or as a share of the screen’s height. Its size is each device’s own.' }, trows));
    }
    // THE TAB BAR, on every screen size: where it sits, how it shrinks, its
    // size and glass (While Scrolling, its tabs and More are each device's)
    tabBarShared(c, v, set, sk, house) {
      var wide = this.hasAttribute('wide'), pos = v.tab_bar_pos || 'bottom', rail = pos === 'left' || pos === 'right';
      var place = [
        K.seg({ label: 'Position', sub: 'Left and right are a rail on a tablet or computer; on a phone the bar stays at the bottom.',
                sk: sk('tab_bar_pos'), value: pos, stack: !wide, options: M.TAB_BAR_POS,
                onChange: function (x) { set({ tab_bar_pos: x }); } })];
      if ((v.tab_bar_scroll || 'shrink') === 'shrink' || v.tab_bar_scroll_phone === 'shrink') {
        place.push(K.seg({ label: 'Shrinks To', sub: rail ? 'The end of the rail the small button sits at.' : 'The side the small button sits at.',
                           sk: sk('tab_bar_fold'), value: v.tab_bar_fold || 'start', stack: !wide, options: M.foldOptions(pos),
                           onChange: function (x) { set({ tab_bar_fold: x }); } }));
        place.push(K.toggle({ label: 'Start Small', sub: 'The bar rests as the small button; tap it to open the bar.',
                              sk: sk('tab_bar_start'), on: v.tab_bar_start === 'small',
                              onChange: function (on) { set({ tab_bar_start: on ? 'small' : 'full' }); } }));
      }
      place.push(K.seg({ label: 'Size', sub: 'The bar’s thickness (a rail’s width), its icons and labels.',
                         sk: sk('tab_bar_size'), value: v.tab_bar_size || 'medium', stack: !wide, options: M.TAB_BAR_SIZES,
                         onChange: function (x) { set({ tab_bar_size: x }); } }));
      // a bar along the bottom always leaves room at the page's end
      // (hk-tabbar.js room()): the switch is the rail's and the top's
      if (pos !== 'bottom') place.push(K.toggle({ label: 'Adjust Content',
                            sub: rail ? 'The page moves aside for the open rail. Off, the rail floats over the page.'
                                      : 'The page slides down clear of the open bar. Off, the bar floats over the page; the page’s start still scrolls clear of it.',
                            sk: sk('tab_bar_adjust'), on: v.tab_bar_adjust !== false,
                            onChange: function (on) { set({ tab_bar_adjust: on }); } }));
      // Same as Screen names the screen's glass (All Screens': Appearance's)
      var scrGlass = M.glassOf(house ? {} : v, this.data.settings.look).effective;
      var glassOpts = M.TAB_BAR_GLASS.map(function (g) {
        return g[0] === 'house' ? ['house', 'Same as Screen (' + M.glassLabel(scrGlass) + ')', M.glassLabel(scrGlass)] : g;
      });
      place.push(K.select({ label: 'Glass', sub: (v.tab_bar_glass || 'house') === 'house' ? 'Same as Screen' : null,
                            sk: sk('tab_bar_glass'), value: v.tab_bar_glass || 'house', options: glassOpts,
                            onChange: function (x) { set({ tab_bar_glass: x }); } }));
      c.appendChild(K.group({ header: 'Tab Bar', footer: (house ? 'For a screen with the tab bar on any device. ' : '') +
          'While Scrolling, the tabs and More are each device’s own. Tinted glass: a near-solid bar, no blur.' }, place));
    }
    // THE HOME ASSISTANT SECTION, on and where: the side menu's and the tab
    // bar's More alike, so it shows for a tab bar screen too
    haRows(c, v, set, sk, house) {
      var inMenu = [K.toggle({ label: 'Home Assistant Section', sk: sk('ha_row'), on: !!v.ha_row,
                   sub: 'Integrations, Automations, Settings, Notifications and more.',
                   onChange: function (on) { set({ ha_row: on }); } })];
      if (v.ha_row || house) inMenu.push(K.select({ label: 'Placement', sub: 'In the side menu and in the tab bar’s More.',
        sk: sk('ha_place'), value: v.ha_place || 'rooms', options: M.HA_PLACES, onChange: function (x) { set({ ha_place: x }); } }));
      // the rooms in the menu, their order and the rest of rooms: Rooms
      if (house) inMenu.push(K.nav({ label: 'Rooms', sub: 'Which rooms, their order and A to Z', href: '#/house/rooms', icon: 'mdi:sofa', sk: 'menu:rooms' }));
      c.appendChild(K.group({ header: 'In the Menu', footer: 'The Home Assistant section shows only what each person may open; Show Menu there opens Home Assistant’s own sidebar.' }, inMenu));
    }
    // ONE PICK OF MANY, then back: the tablets' button style, Phones', the
    // highlight (All Screens' or a screen's own)
    menuStyle(c, cur, pick, swipe) {
      c.appendChild(K.group({ footer: 'Below 1,024 px — an iPad held upright, Split View — the screen shows its Phones menu.' +
          (swipe ? '' : ' Turn on Swipe from Left Edge to choose No Button.') },
        M.stylesFor(M.MENU_STYLES, swipe, cur).map(function (s) {
          return K.check({ label: s[1], sub: s[2], on: cur === s[0], fk: 'style:' + s[0], onClick: function () { pick(s[0]); } });
        })));
    }
    // PHONES' BUTTON STYLE (button_phone)
    phoneStyle(c, cur, pick, swipe) {
      c.appendChild(K.group({ footer: M.DEVICES.phones + ' Also a tablet whose own menu doesn’t fit.' +
          (swipe ? '' : ' Turn on Swipe from Left Edge to choose No Button.') },
        M.stylesFor(M.BUTTON_PHONE, swipe, cur).map(function (n) {
          return K.check({ label: n[1], sub: n[2], on: (cur || 'chip') === n[0], fk: 'phone:' + n[0], onClick: function () { pick(n[0]); } });
        })));
    }
    // A PAGE'S HIGHLIGHT (look.page_accents): its default first, then the
    // colors and your own -- the page you're on in the menu, while a
    // screen's Highlight Color is Automatic
    pageAccent(c, key) {
      var self = this, all = this.hs('look.page_accents') || {}, pa = M.pageAccentOf(key, all);
      var put = function (v) {
        var next = Object.assign({}, all);
        if (v) next[key] = v; else delete next[key];
        self.setH({ 'look.page_accents': next });
      };
      c.appendChild(K.group({ footer: 'The page’s own color: in the menu when you’re on it, while a screen’s Highlight Color is Automatic, and in Flat a very light or very dark shade of it is the page’s Automatic background. Choosing another Background overrides that.' }, [
        K.check({ label: 'Default', sub: pa.d.name, tile: ['', pa.d.hex], on: !pa.own, fk: 'paccent:default', onClick: function () { put(null); } })]));
      c.appendChild(K.group({ header: 'Colors' }, M.ACCENTS.map(function (x) {
        return K.check({ label: x[1], tile: ['', x[2]], on: pa.own && !pa.a.custom && pa.a.hex === x[2], fk: 'paccent:' + x[0], onClick: function () { put(x[0]); } });
      })));
      var row = K.text({ label: 'Your Own Color', sub: pa.own && pa.a.custom ? pa.a.hex : 'Pick any color.', type: 'color', fk: 'paccent:custom',
                         value: pa.a.hex, error: this.err('look.page_accents'),
                         onCommit: function (t) { if (/^#[0-9a-f]{6}$/i.test(t)) put(t.toLowerCase()); } });
      var inp = row.querySelector('input');
      if (inp) {
        inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
        inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) put(inp.value.toLowerCase()); });
      }
      c.appendChild(K.group({ header: 'Custom' }, [row]));
    }
    menuAccent(c, cur, pick, fsc) {
      var a = M.accentOf(cur);
      // WHILE FLAT'S ACCENT COLOR IS CHOSEN it marks the page you're on in
      // Flat; this one stays saved for the other looks and an Automatic Accent
      var fr = fsc && fsc.resolved().accent;
      if (fr && fr.value !== 'auto') {
        c.appendChild(K.group({ footer: 'In Flat, the menu uses the Flat Accent Color, ' + M.flatColorName(fr.value) +
            ' — its icons and the page you’re on. This Highlight Color stays saved for the other looks, and for Flat when the Accent Color is Automatic.' },
          [K.nav({ label: 'Using Flat Accent Color', value: M.flatColorName(fr.value), tile: ['', M.flatColorHex(fr.value)], href: fsc.href })]));
      }
      c.appendChild(K.group({ footer: 'Colors the menu’s icons and the page you’re on. In Flat the page you’re on is always white over the color; in the other looks, over a pale color its name turns dark.' },
        [K.check({ label: 'Automatic', sub: 'The page you’re on in its own color: Climate blue, Lights yellow, Security teal, Calendar purple, Weather cyan, Energy green, Music pink, Cameras red; Home and the rooms orange. The other icons stay orange. Each page’s color is its Accent Color, under Pages → the page.',
                   tile: ['', AUTO_ACCENT_TILE], on: !!a.auto, fk: 'accent:auto',
                   onClick: function () { pick('auto'); } })].concat(M.ACCENTS.map(function (x) {
          return K.check({ label: x[1], tile: ['', x[2]], on: !a.auto && !a.custom && a.hex === x[2],
                           fk: 'accent:' + x[0], onClick: function () { pick(x[0]); } });
        }))));
      var row = K.text({ label: 'Your Own Color', sub: a.custom ? a.hex : 'Pick any color.', type: 'color', fk: 'accent:custom',
                         value: a.hex, error: this.err('menu.accent') || this.err('b:accent'),
                         onCommit: function (t) { if (/^#[0-9a-f]{6}$/i.test(t)) pick(t.toLowerCase()); } });
      var inp = row.querySelector('input');
      if (inp) {
        inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
        inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) pick(inp.value.toLowerCase()); });
      }
      c.appendChild(K.group({ header: 'Custom' }, [row]));
    }
    // A CHIP ACROSS THE SCREENS: each screen with a Home page -- its chip row
    // on or off, and this chip in it (Always or When Active) or not
    chipScreens(kind) {
      var self = this, d = this.data, kinds = d.chip_kinds || [], lib = d.custom_chips || [];
      return Object.keys(d.boards || {}).map(function (p) {
        var b = d.boards[p], x = self.dash(p);
        if (!x || b.home_page === false) return null;
        if (!b.chips_row) return { path: p, title: x.title, b: b, row: false };
        var m = M.chipsModel(b, kinds, lib), r = m.rows.filter(function (y) { return y.value === kind; })[0];
        var quiet = !!(r && r.quiet);
        // a custom chip's: this screen's Show for it, else as written
        if (r && r.custom) quiet = self.customShow(b, r.key) === 'active';
        return { path: p, title: x.title, b: b, row: true, on: !!r, quiet: quiet, auto: m.auto };
      }).filter(Boolean).sort(function (a, b) { return a.title.localeCompare(b.title); });
    }
    // A CUSTOM CHIP'S SHOW (2026-10-13; hk-chip.js copyAs): this screen's
    // choice, else as written -- a conditional one When Active, the rest
    // Always. Only a status chip (or one in a conditional) can be either.
    customChip(key) { return (this.data.custom_chips || []).filter(function (x) { return x.key === key; })[0] || null; }
    customShow(b, key) {
      var mine = (b && b.chips_custom_show || {})[key];
      if (mine) return mine;
      var ch = this.customChip(key);
      return ch && ch.card && ch.card.type === 'conditional' ? 'active' : 'always';
    }
    customSwitchable(key) {
      var c = (this.customChip(key) || {}).card || {};
      return c.type === 'custom:hk-status-chip-card' || (c.type === 'conditional' && c.card && c.card.type === 'custom:hk-status-chip-card');
    }
    // in a few words: "Always on 2 · When Active on 1"
    chipSays(list) {
      var a = list.filter(function (s) { return s.on && !s.quiet; }).length, q = list.filter(function (s) { return s.on && s.quiet; }).length;
      var parts = [];
      if (a) parts.push('Always on ' + a);
      if (q) parts.push('When Active on ' + q);
      return parts.join(' · ') || 'On No Screens';
    }
    // the chips a type feeds (M.CHIP_SOURCES turned around; a garage door is
    // counted by Doors & Windows too)
    chipsOfType(kind) {
      var out = Object.keys(M.CHIP_SOURCES).filter(function (ch) { return (M.CHIP_SOURCES[ch].kinds || []).indexOf(kind) >= 0; });
      if (kind === 'garage' && out.indexOf('doors_windows') < 0) out.push('doors_windows');
      return out.filter(function (ch) { return (this.data.chip_kinds || []).indexOf(ch) >= 0; }, this);
    }
    h_chips(c) {
      var self = this, d = this.data, kinds = d.chip_kinds || [];
      var screens = Object.keys(d.boards || {}).map(function (p) { return { p: p, b: d.boards[p], x: self.dash(p) }; })
        .filter(function (o) { return o.x && o.b.home_page !== false; })
        .sort(function (a, b) { return a.x.title.localeCompare(b.x.title); });
      c.appendChild(K.group({ header: 'Screens', footer: 'Each screen’s chip row: on or off, Automatic (a chip for everything the house has) or its own chips in its own order.' },
        screens.map(function (o) {
          var b = o.b, v = !b.chips_row ? 'Off' : (b.chips || []).length ? b.chips.length + ' Chips' : 'Automatic';
          return K.nav({ label: o.x.title, value: v, href: '#/screens/' + encodeURIComponent(o.p) + '/chips', sk: 'chips:screen:' + o.p });
        })));
      c.appendChild(K.group({ header: 'Chips', footer: 'Each chip on every screen: Always, or only When Active — while something is on, open, running or wet. Smoke & CO needs nothing here: it leads every screen’s row, in red, when an alarm goes off.' },
        kinds.map(function (k) {
          return K.nav({ label: M.CHIP_LABELS[k] || k, value: self.chipSays(self.chipScreens(k)), href: '#/house/chips/' + k, sk: 'chips:kind:' + k });
        })));
      var lib = d.custom_chips || [];
      if (lib.length) c.appendChild(K.group({ header: 'Custom Chips', footer: 'Your own chips, set the same way. Always takes a conditional chip out of its condition; When Active shows one only while its entity is on, open or running — or as its own active: rules say.' },
        lib.map(function (x) {
          return K.nav({ label: x.name, value: self.chipSays(self.chipScreens('chip:' + x.key)), href: '#/house/chips/' + encodeURIComponent('chip:' + x.key),
                         sk: 'chips:kind:chip:' + x.key });
        })));
      c.appendChild(this.chipCountsGroup());
    }
    // WHAT THE CHIPS COUNT, a tap away (2026-10-13): adding to a chip or
    // hiding from it is Accessories', type by type -- said and linked on
    // every Status Chips page
    chipCountsGroup() {
      return K.group({ header: 'What the Chips Count', footer: 'To count something more in a chip — an outlet with a lamp, a group helper — or hide something from it, open its type in Accessories: Add… and Hidden are there. The same on every screen. Your own chips are in Custom Chips.' }, [
        K.nav({ label: 'Accessories', sub: 'Add to a chip, or hide from it, type by type', icon: 'mdi:lightbulb-group', href: '#/accessories', sk: 'chips:accessories' }),
        K.nav({ label: 'Custom Chips', sub: 'Chips you write yourself', icon: 'mdi:label-variant', href: '#/chips', sk: 'chips:custom' })]);
    }
    h_chipOne(c, kind) {
      var self = this, list = this.chipScreens(kind), wide = this.hasAttribute('wide');
      var on = list.filter(function (s) { return s.on; }), off = list.filter(function (s) { return !s.on; });
      var ckey = kind.indexOf('chip:') === 0 ? kind.slice(5) : null, cchip = ckey ? this.customChip(ckey) : null;
      if (ckey && !cchip) { c.appendChild(K.group({ footer: 'That chip isn’t there any more.' }, [])); return; }
      var setShow = function (s, quiet) {
        if (!ckey) return self.setB(s.path, M.chipQuiet(s.b, kind, quiet));
        var m = Object.assign({}, s.b.chips_custom_show || {});
        m[ckey] = quiet ? 'active' : 'always';
        return self.setB(s.path, { chips_custom_show: m });
      };
      var can = !ckey || this.customSwitchable(ckey);
      if (on.length) c.appendChild(K.group({ header: 'Shown On', footer: !can
          ? 'It is written as another kind of card, so it shows as written. A status chip (custom:hk-status-chip-card), or one inside a conditional, can be Always or When Active.'
          : ckey ? 'When Active: only while ' + (cchip.card.type === 'conditional' ? 'its condition is met' : 'its entity is on, open or running — or as its own active: rules say') +
                   '. Always: all the time' + (cchip.card.type === 'conditional' ? ', out of its condition.' : '.')
          : 'When Active: only while something is on, open, running or wet — Doors & Windows only while one is open.' },
        on.map(function (s) {
          if (!can) return K.info({ label: s.title, value: 'As Written' });
          return K.seg({ label: s.title, sk: 'chips:quiet:' + s.path, value: s.quiet ? 'quiet' : 'always', stack: !wide,
                         options: [['always', 'Always'], ['quiet', 'When Active']],
                         onChange: function (v) { setShow(s, v === 'quiet'); } });
        })));
      if (ckey) {
        c.appendChild(K.group({ footer: 'Its name, where it sits and its YAML.' }, [
          K.nav({ label: 'Edit ' + cchip.name, icon: 'mdi:code-braces', href: '#/chips/' + encodeURIComponent(ckey), sk: 'chips:edit:' + ckey })]));
      }
      if (off.length) c.appendChild(K.group({ header: 'Not Shown On', footer: 'Add it on the screen’s Status Chips.' },
        off.map(function (s) {
          return K.nav({ label: s.title, value: s.row ? 'Not in Its Row' : 'Chip Row Off', href: '#/screens/' + encodeURIComponent(s.path) + '/chips', sk: 'chips:add:' + s.path });
        })));
      var src = M.CHIP_SOURCES[kind] || {};
      var counts = (src.kinds || []).concat(kind === 'doors_windows' ? ['garage'] : []).filter(function (k, i, a) { return a.indexOf(k) === i; });
      // a chip that reads one setting (Weather Alerts, Energy): no types to open
      if (!counts.length && !ckey) c.appendChild(K.group({ header: 'What It Counts', footer: 'This chip reads one setting rather than a type of accessory: set it on any screen’s page for this chip.' }, []));
      if (counts.length) c.appendChild(K.group({ header: 'What It Counts', footer: 'Tap a type to change what this chip counts: Add… counts something more (an outlet with a lamp, a group helper); open an accessory to hide it from the chip. The same on every screen.' }, counts.map(function (k) {
        var T = M.accType(k);
        return K.nav({ label: T ? T[1] : k, tile: T ? [T[2], T[3]] : null, value: String((((self.data.counts || {})[k] || {}).found || []).length),
                       href: '#/accessories/type/' + k });
      })));
    }
    s_chips(c, x, b) {
      var self = this, path = x.path, base = '#/screens/' + encodeURIComponent(path);
      var set = function (ch) { return self.setB(path, ch); };
      var kinds = this.data.chip_kinds;
      c.appendChild(K.group({ footer: b.chips_row ? null : 'No chip row on this screen.' }, [
        K.toggle({ label: 'Show Status Chips', sk: 'b:chips_row', on: b.chips_row, onChange: function (on) { set({ chips_row: on }); } })]));
      if (!b.chips_row) return;
      var lib = this.data.custom_chips || [];
      var mdl = M.chipsModel(b, kinds, lib);
      var lab = function (r) { return r.custom ? r.name : r.own ? self.name(r.value) : M.CHIP_LABELS[r.value] || r.value; };
      c.appendChild(K.listEditor({
        fk: 'chips', auto: mdl.auto, announce: this.announce.bind(this), minRows: 1,
        autoFooter: 'Automatic shows a chip for everything the house has, in the usual order. A kind the house has nothing of never shows.',
        rows: mdl.rows.map(function (r) {
          return { value: r.value, label: lab(r), removable: r.own || r.custom,
                   sub: r.custom ? 'Custom chip' + (self.customShow(b, r.key) === 'active' ? ' · Only When Active' : '') : r.own ? 'Accessory chip' : r.quiet ? 'Only When Active' : null,
                   href: r.custom ? '#/chips/' + encodeURIComponent(r.key)
                                  : r.own ? '#/accessories/' + encodeURIComponent(r.value) : base + '/chips/' + r.value };
        }),
        more: mdl.more.map(function (r) { return { value: r.value, label: lab(r), sub: r.custom ? 'Custom chip' : null }; }),
        onAdd: function (v) {
          if (v.indexOf(M.CHIP_TOKEN) === 0) { set(M.chipsAddCustom(b, v.slice(M.CHIP_TOKEN.length))); return; }
          set(M.chipsSave(mdl.rows.map(function (r) { return r.value; }).concat(v), kinds, lib));
        },
        onAuto: function (on) {
          if (!on) { set({ chips: mdl.rows.map(function (r) { return r.value; }) }); return; }
          self.confirmSwitch({ title: 'Use Automatic Chips?', message: 'This screen’s chip order and choices will be replaced.', ok: 'Use Automatic' },
              function () { set({ chips: [] }); });
        },
        onChange: function (v) { set(M.chipsSave(v, kinds, lib)); },
        onRemove: function (v) {
          if (v.indexOf(M.CHIP_TOKEN) === 0) { set(M.chipsRemoveCustom(b, v.slice(M.CHIP_TOKEN.length))); return; }
          set(M.chipsRemoveOwn(b, v));
        },
        addLabel: 'Add Accessory Chip…', onAddOther: function () {
          self.go(self.picker('chip-add', { title: 'Add Accessory Chip', value: null, multi: true,
            items: function () {
              return self.entityIds({ re: CHIP_POOL, shown: true }).filter(function (id) { return (b.chips_extra || []).indexOf(id) < 0; })
                .map(function (id) { return { value: id, label: self.name(id), sub: id }; });
            },
            onPick: function (id) { if (id) set(M.chipsAddOwn(b, id)); } }));
        }
      }));
      c.appendChild(this.chipCountsGroup());
      c.appendChild(K.group({ footer: h('span', {}, ['Every screen’s chips side by side: ', h('a', { href: '#/house/chips', text: 'All Screens → Status Chips' }),
        '. An accessory chip’s look is in its settings.']) }, [
        K.nav({ label: 'All Screens’ Status Chips', icon: 'mdi:label-multiple', href: '#/house/chips', sk: 'chips:all' })]));
    }
    s_chip(c, x, b, kind) {
      var self = this, quiet = (b.chips_quiet || []).indexOf(kind) >= 0;
      c.appendChild(K.group({ footer: 'When Active: the chip appears only while something is on, open, running or wet — Doors & Windows only while one is open.' }, [
        K.seg({ label: 'Show', sk: 'b:chips_quiet:' + kind, value: quiet ? 'quiet' : 'always', stack: !this.hasAttribute('wide'),
                options: [['always', 'Always'], ['quiet', 'When Active']],
                onChange: function (v) { self.setB(x.path, M.chipQuiet(b, kind, v === 'quiet')); } })]));
      var src = M.CHIP_SOURCES[kind] || {}, rows = [];
      (src.kinds || []).forEach(function (k) {
        var ck = (self.data.counts || {})[k] || { found: [] };
        var lbl = M.COUNT_KINDS.filter(function (y) { return y[0] === k; })[0];
        rows.push(K.nav({ label: lbl ? lbl[1] : k, value: String(ck.found.length), href: '#/accessories/type/' + k }));
      });
      if (src.setting && src.setting[0] === 'here') {
        // THE CHIP'S READING, chosen here (was Status & Chips -> Readings): the
        // house's, the same on every screen
        var rk = src.setting[1] === 'Indoor Temperature' ? 'features.temperature' : 'features.power';
        rows.push(this.entityRow({ label: src.setting[1], sk: rk, value: this.hs(rk),
          none: rk === 'features.temperature' ? 'First Thermostat’s' : 'None',
          filter: { domains: ['sensor'], dc: rk === 'features.temperature' ? 'temperature' : 'power' },
          onPick: function (v) { var o = {}; o[rk] = v; self.setH(o); } }));
      } else if (src.setting) {
        var map = { 'Alarm Panel': 'security.alarm', 'Weather Alerts Sensor': 'weather.alerts' };
        var v = this.hs(map[src.setting[1]]);
        rows.push(K.nav({ label: src.setting[1], value: v ? this.name(v) : 'None', href: '#/' + src.setting[0] }));
      }
      c.appendChild(K.group({ header: 'What It Counts', footer: (src.kinds || []).length ? 'Tap a type to change what this chip counts: Add… counts something more (an outlet with a lamp, a group helper); open an accessory to hide it from the chip. The same on every screen.' : 'The same on every screen.' }, rows));
    }
    // NOT THE HOUSE'S CAMERAS (hk-strategy.js notHouseCamera: its rule, when it is loaded):
    // a wall tablet's own -- Fully Kiosk's, or Kiosk Satellite's, which comes
    // through ESPHome and is told apart by its device's manufacturer -- and
    // Live TV's channels.
    notHouseCamera(id) {
      var hs = this.client || {}, e = (hs.entities || {})[id] || {};
      var S = window.hkStrategy;
      if (S && typeof S.notHouseCamera === 'function') return S.notHouseCamera(hs, e);
      if ({ fully_kiosk: 1, hk_frontend: 1, hk_tv: 1 }[e.platform]) return true;
      var d = e.device_id && (hs.devices || {})[e.device_id];
      return !!d && d.manufacturer === 'kiosk_satellite';
    }
    s_cameras(c, x, b) {
      var self = this, set = function (ch) { return self.setB(x.path, ch); }, ents = this.client.entities || {};
      var ok = this.entityIds({ domains: ['camera'], shown: true }).filter(function (id) { return !self.notHouseCamera(id); }).sort();
      var autoCams = M.autoCameras(ok, function (id) { return (ents[id] || {}).device_id; });
      var top = [];
      if (x.generated) top.push(K.toggle({ label: 'Show Camera Strip', sk: 'b:camera_strip', on: b.camera_strip,
                                           onChange: function (on) { set({ camera_strip: on }); } }));
      top.push(this.entityRow({ label: 'Live Camera Follows', sk: 'b:camera_live', value: b.camera_live || null, none: 'First Camera',
        filter: { domains: ['input_select', 'select'] }, onPick: function (v) { set({ camera_live: v || '' }); } }));
      top.push(K.nav({ label: 'Set Up Live Camera Follows', href: '#/screens/' + encodeURIComponent(x.path) + '/cameras/live',
                       icon: 'mdi:cctv', fk: 'cams:live' }));
      // LIVE FIRST CAMERA, this screen's own or All Screens' (2026-10-10)
      var hLive = (this.data.settings.cameras || {}).live !== false, ownLive = typeof b.camera_live_video === 'boolean';
      top.push(K.toggle({ label: 'Live First Camera', sk: 'b:camera_live_video', on: ownLive ? b.camera_live_video : hLive,
        sub: ownLive ? 'Just This Screen' : 'Same as All Screens', onChange: function (on) { set({ camera_live_video: on }); } }));
      if (ownLive) top.push(K.button({ label: 'Reset to All Screens (' + (hLive ? 'On' : 'Off') + ')', sk: 'b:camera_live_video:reset',
                                       onClick: function () { set({ camera_live_video: null }); } }));
      c.appendChild(K.group({ footer: 'The first tile plays live video; the others show snapshots. A dropdown helper can choose which camera is first — the one where someone was just seen, say. ' +
          'Live First Camera off makes the first tile a snapshot too: no video to decode, lighter on a computer or an older tablet.' }, top));
      if (x.generated && !b.camera_strip) { this.cameraRelated(c, x); return; }
      // WHICH CAMERAS: All Screens' (Cameras, on the sidebar), or this
      // screen's own. Turning Same off starts from All Screens' as they are.
      var follows = !b.cameras_custom;
      c.appendChild(K.group({ footer: follows ? 'This screen’s cameras follow Cameras (All Screens). Turn this off to choose them here, for this screen only.'
          : 'This screen sets its own. Turn this on to follow Cameras (All Screens) again.' }, [
        K.toggle({ label: 'Same as All Screens', sk: 'b:cameras_custom', on: follows, onChange: function (on) {
          if (!on) { set({ cameras_custom: true, cameras: (b.cameras || []).slice() }); return; }
          self.confirmSwitch({ title: 'Follow All Screens’ Cameras?', message: 'This screen’s own camera order and choices will be replaced.', ok: 'Follow All Screens' },
              function () { set({ cameras_custom: false }); });
        } })]));
      if (follows) {
        this.fromAllScreens(c, [K.info({ label: 'Cameras', value: (b.cameras || []).length ? b.cameras.length + ' Cameras' : 'Automatic' })],
                            'Cameras', '#/page/cameras');
        this.cameraRelated(c, x);
        return;
      }
      var mdl = M.camerasModel(b, ok, autoCams);
      c.appendChild(K.listEditor({ fk: 'cams', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
        autoFooter: 'Automatic shows one of every camera, its low-resolution channel. The Cameras page shows the same ones.',
        rows: mdl.rows.map(function (r) { return { value: r.value, label: self.name(r.value) }; }),
        more: mdl.more.map(function (r) { return { value: r.value, label: self.name(r.value) }; }),
        onAuto: function (on) {
          if (!on) { set({ cameras: mdl.rows.map(function (r) { return r.value; }) }); return; }
          self.confirmSwitch({ title: 'Use Automatic Cameras?', message: 'This screen’s camera order and choices will be replaced.', ok: 'Use Automatic' },
              function () { set({ cameras: [] }); });
        },
        onChange: function (v) { set({ cameras: v }); } }));
      this.cameraRelated(c, x);
    }
    // LIVE CAMERA FOLLOWS, explained where it is set: what it does, the
    // dropdown's options for this screen's cameras (made for you, if you
    // like), and the automation that moves it, written for your cameras'
    // own person and motion sensors (M.livePlan, M.liveYaml).
    s_cameraLive(c, x, b) {
      var self = this, hs = this.client, ents = hs.entities || {}, devs = hs.devices || {};
      var set = function (ch) { return self.setB(x.path, ch); };
      var ok = this.entityIds({ domains: ['camera'], shown: true }).filter(function (id) { return !self.notHouseCamera(id); }).sort();
      var mdl = M.camerasModel(b, ok, M.autoCameras(ok, function (id) { return (ents[id] || {}).device_id; }));
      var cams = mdl.rows.map(function (r) {
        var dev = devs[(ents[r.value] || {}).device_id] || {};
        return { entity: r.value, name: self.name(r.value), device: (ents[r.value] || {}).device_id || null,
                 deviceName: dev.name_by_user || dev.name || null };
      });
      var onCam = {};
      cams.forEach(function (x2) { if (x2.device) onCam[x2.device] = true; });
      var sensors = Object.keys(ents).filter(function (id) {
        return id.indexOf('binary_sensor.') === 0 && onCam[ents[id].device_id];
      }).map(function (id) {
        var st = hs.states[id], dc = st && st.attributes.device_class;
        var kind = /person/.test(id) ? 'person' : (dc === 'motion' || dc === 'occupancy' || /motion/.test(id)) ? 'motion' : null;
        return { entity: id, device: ents[id].device_id, kind: kind };
      }).filter(function (s2) { return s2.kind; });
      var sel = b.camera_live || '';
      var selSt = sel && hs.states[sel];
      var have = selSt && Array.isArray(selSt.attributes.options) ? selSt.attributes.options.map(String) : null;
      var plan = M.livePlan(cams, sensors, have);

      c.appendChild(K.group({ header: 'How It Works', footer: 'The camera strip’s first tile plays live; the others are snapshots. ' +
          'Live Camera Follows is a dropdown helper (an input_select) whose options are your cameras’ names. Whichever option is ' +
          'chosen, that camera plays live. An automation that chooses the camera where a person or motion was just seen makes ' +
          'the strip follow what’s happening. Nothing chosen, or an option that names no camera: the first camera plays.' }, [
        this.entityRow({ label: 'Live Camera Follows', sk: 'b:camera_live', value: sel || null, none: 'First Camera',
          filter: { domains: ['input_select', 'select'] }, onPick: function (v) { set({ camera_live: v || '' }); } })]));

      if (!plan.length) {
        c.appendChild(K.group({ footer: 'This screen has no cameras in its strip yet. Add them on the Cameras page first.' }, []));
        return;
      }
      var opts = plan.map(function (p) { return p.option; });
      var rows = plan.map(function (p) {
        return K.info({ label: p.option, sub: p.name + ' · ' + (p.missing ? 'not in the dropdown yet — add this option'
          : p.sensor ? 'follows ' + self.name(p.sensor) : 'no motion sensor found'), valueCls: p.missing ? 'warn' : null,
          value: p.missing ? 'Missing' : undefined });
      });
      var missing = plan.filter(function (p) { return p.missing; }).length;
      if (!sel) {
        rows.push(K.button({ label: 'Create the Dropdown', fk: 'cams:live:create', onClick: function () {
          self.actions().callWS({ type: 'input_select/create', name: 'Live Camera', icon: 'mdi:cctv', options: opts }).then(function (item) {
            return set({ camera_live: 'input_select.' + item.id }).then(function () { self.announce('Live Camera made and chosen'); });
          }, function (e) { self.announce('Couldn’t make it: ' + ((e && e.message) || e)); });
        } }));
      }
      c.appendChild(K.group({ header: '1. The Dropdown’s Options', footer: sel
          ? (missing ? 'The dropdown has no option for ' + (missing === 1 ? 'one camera' : missing + ' cameras') + ' in this ' +
              'screen’s strip. Add ' + (missing === 1 ? 'it' : 'them') + ', spelled as shown, in ' + haPlace('Settings → Devices & Services → Helpers') + '; until then the automation leaves ' + (missing === 1 ? 'it' : 'them') + ' out.'
            : 'The dropdown has an option for every camera in this screen’s strip.')
          : 'Create the Dropdown makes a dropdown helper called Live Camera with these options, and chooses it above. ' +
            'Or make your own in ' + haPlace('Settings → Devices & Services → Helpers → Create Helper → Dropdown') + '.' }, rows));

      var yaml = M.liveYaml(plan, sel || 'input_select.live_camera');
      if (!yaml) {
        c.appendChild(K.group({ header: '2. The Automation', footer: 'None of these cameras has a person or motion sensor on its ' +
          'device, so there’s nothing to write for you. Make an automation that sets the dropdown to a camera’s option when ' +
          'something happens there.' }, []));
        return;
      }
      var pre = h('pre', { class: 'code', text: yaml, tabindex: '0', 'aria-label': 'The automation, in YAML' });
      c.appendChild(K.group({ header: '2. The Automation', footer: 'Copy it, then in Settings → Automations & Scenes choose ' +
          'Create Automation → Create New Automation → ⋮ → Edit in YAML, paste it over everything there, and save. It chooses the ' +
          'camera where a person (or motion) was just seen, and the first camera again after five quiet minutes. ' +
          (sel ? '' : 'It sets Live Camera; if you name your dropdown differently, change input_select.live_camera in it.') }, [
        K.button({ label: 'Copy Automation', fk: 'cams:live:copy', onClick: function () {
          var done = function () { self.announce('Copied'); };
          var fallback = function () {
            var r = document.createRange(); r.selectNodeContents(pre);
            var s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(r);
            self.announce('Selected — copy it with your keyboard');
          };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(yaml).then(done, fallback);
          else fallback();
        } }),
        K.nav({ label: 'Open Automations', href: '/config/automation/dashboard', icon: 'mdi:open-in-new', fk: 'cams:live:auto' })]));
      c.appendChild(pre);
    }
    s_scenes(c, x, b) {
      var self = this, set = function (ch) { return self.setB(x.path, ch); }, ents = this.client.entities || {};
      c.appendChild(K.group({}, [K.toggle({ label: 'Show Scenes Row', sk: 'b:scenes_row', on: b.scenes_row,
                                            onChange: function (on) { set({ scenes_row: on }); } })]));
      if (!b.scenes_row) return;
      var autoScenes = x.generated ? this.entityIds({ domains: ['scene'], shown: true })
        .sort(function (p, q) { return self.name(p).localeCompare(self.name(q)); }) : [];
      void ents;
      // the Energy page's pill only while the Energy feature gives it a page
      var energyOn = this.energyOn(), powerOn = this.powerOn();
      var scenePages = (this.data.scene_pages || []).filter(function (k) { return (k !== 'energy' || energyOn) && (k !== 'power' || powerOn); });
      var mdl = M.scenesModel(b, autoScenes, scenePages);
      var pills = this.hs('look.page_pills') || {};
      var lab = function (r) { return r.page ? (pills[r.page] || {}).name || M.PAGE_LABELS[r.page] || r.page : self.name(r.value); };
      c.appendChild(K.listEditor({ fk: 'scenes', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
        autoFooter: x.generated ? 'Automatic shows every scene, A to Z, then any page pills.' :
          'Automatic shows the scenes this screen’s YAML lists, then any page pills. Choosing scenes here replaces the YAML’s list.',
        emptyText: x.generated ? 'No scenes' : 'The scenes in this screen’s YAML',
        rows: mdl.rows.map(function (r) {
          return { value: r.value, label: lab(r), sub: r.page ? 'Opens the page' : null, removable: !!r.page,
                   href: r.page ? '#/page/' + r.page + '/pill'
                                : '#/accessories/' + encodeURIComponent(r.value) };
        }),
        more: mdl.more.map(function (r) { return { value: r.value, label: lab(r), sub: 'A pill that opens the page' }; }),
        onAuto: function (on) {
          if (!on) { set(M.scenesSave(mdl.rows.map(function (r) { return r.value; }))); return; }
          self.confirmSwitch({ title: 'Use Automatic Scenes?', message: 'This screen’s scene order and choices will be replaced.', ok: 'Use Automatic' },
              function () { set({ scenes: [] }); });
        },
        onAdd: mdl.auto ? function (v) { set(M.scenesPagePill(b, v.slice(M.PAGE_TOKEN.length), true)); } : null,
        onRemove: function (v) { set(M.scenesPagePill(b, v.slice(M.PAGE_TOKEN.length), false)); },
        onChange: function (v) { set(M.scenesSave(v)); },
        addLabel: 'Add Scene or Shortcut…', onAddOther: function () {
          self.go(self.picker('scene-add', { title: 'Add Scene or Shortcut', value: null, multi: true,
            items: function () {
              return self.entityIds({ re: SCENE_POOL, shown: true })
                .filter(function (id) { return mdl.rows.every(function (r) { return r.value !== id; }); })
                .map(function (id) { return { value: id, label: self.name(id), sub: id }; });
            },
            onPick: function (id) { if (id) set(M.scenesSave(mdl.rows.map(function (r) { return r.value; }).concat(id))); } }));
        } }));
      c.appendChild(K.group({ footer: 'A scene’s name, icon and color on the pill are in its settings. A page pill’s are the same on every screen (All Screens → Appearance → Page Pills): tap it.' }, []));
    }
    // A PAGE PILL'S LOOK: its name, icon and color, the same on
    // every screen (look.page_pills) -- "Play Music" can be "Apple Music"
    // A SCREEN'S PAGE HEADERS (2026-10-16): each page's header Same as All
    // Screens or Off on This Screen (its `headers`, {page: false}). What a
    // header held comes back when it is off (the Water page's main valve,
    // Timers' Quick Start).
    s_pageHeaders(c, x, b) {
      var self = this, S = this.data.settings || {}, own = b.headers || {};
      var listed = this.pagesListed().filter(function (p) { return M.HEADER_PAGES[p[0]] && M.screenShows(b, p[0]); });
      if (!listed.length) { c.appendChild(K.group({ footer: 'None of this screen’s pages has a header.' }, [])); return; }
      c.appendChild(K.group({ footer: 'Off here, a page’s header is off on this screen alone; what it held comes back to the page — the Water page’s main valve as a tile, ' +
          'the Timers page’s Quick Start beside what runs. A header off for All Screens is off everywhere (its page, under Pages).' },
        listed.map(function (p) {
          var house = ((S.headers || {})[p[0]] || {}).show !== false, mine = own[p[0]] === false;
          return K.toggle({ label: p[1], sub: !house ? 'Off for All Screens' : mine ? 'Off on This Screen' : 'Same as All Screens',
            on: house && !mine, disabled: !house, sk: 'b:headers', fk: 'pghd:' + p[0],
            onChange: function (on) {
              var next = Object.assign({}, own);
              if (on) delete next[p[0]]; else next[p[0]] = false;
              self.setB(x.path, { headers: next });
            } });
        })));
    }
    s_pill(c, x, b, kind) {
      var self = this, all = Object.assign({}, this.hs('look.page_pills') || {}), mine = Object.assign({}, all[kind] || {});
      var put = function (k, v) {
        var next = Object.assign({}, mine);
        if (v) next[k] = v; else delete next[k];
        var out = Object.assign({}, all);
        if (Object.keys(next).length) out[kind] = next; else delete out[kind];
        self.setH({ 'look.page_pills': out });
      };
      var def = M.PAGE_PILL_DEFAULTS[kind] || ['', '', 'white'];
      c.appendChild(K.group({ footer: 'The pill on every screen that shows it. Empty: its own ' + (def[0] ? '“' + def[0] + '”' : 'name') + '.' }, [
        K.text({ label: 'Name', sk: 'look.page_pills', value: mine.name || '', placeholder: def[0], maxlength: 40,
                 error: this.err('look.page_pills'), onCommit: function (v) { put('name', v.trim()); } }),
        K.text({ label: 'Icon', sk: 'look.page_pills.icon', value: mine.icon || '', placeholder: def[1], maxlength: 60,
                 onCommit: function (v) { put('icon', v.trim()); } }),
        K.select({ label: 'Color', sk: 'look.page_pills.color', value: mine.color || '', placeholder: 'Default',
                   options: [['', 'Default (' + M.colorLabel(def[2]) + ')']].concat(M.PILL_COLORS.map(function (k) { return [k, M.colorLabel(k)]; })),
                   onChange: function (v) { put('color', v); } })]));
      void x; void b;
    }
    s_favorites(c, x, b) {
      var self = this, set = function (ch) { return self.setB(x.path, ch); };
      c.appendChild(K.listEditor({ fk: 'favs', announce: this.announce.bind(this), emptyText: 'No Favorites section',
        shownHeader: 'Favorites',
        rows: b.favorites.map(function (id) { return { value: id, label: self.name(id), href: '#/accessories/' + encodeURIComponent(id) }; }),
        onChange: function (v) { set({ favorites: v }); },
        addLabel: 'Add Favorite…', onAddOther: function () {
          self.go(self.picker('fav-add', { title: 'Add Favorite', value: null, multi: true,
            items: function () {
              return self.entityIds({ re: FAV_POOL, shown: true }).filter(function (id) { return b.favorites.indexOf(id) < 0; })
                .map(function (id) { return { value: id, label: self.name(id), sub: self.areaName(self.areaOf(id)) || id }; });
            },
            onPick: function (id) { if (id) set({ favorites: b.favorites.concat(id) }); } }));
        } }));
      c.appendChild(K.group({ footer: 'A Favorites section above the rooms. A favorite’s own name and icon there are in its settings.' }, []));
    }
    // SLEEP SCREEN (2026-10-09; sleep_rules.py, sleep_engine.py): HOW the
    // tablet goes dark (Drawn By, While Dark), WHO decides when (an
    // automation, or HK Frontend), and -- HK Frontend deciding -- the rules:
    // the kiosk, the photos' time, quiet hours, presence and the lists, and
    // the brightness. Every write sends the whole Sleep Screen (the server
    // keeps no half of it).
    // WHOSE SLEEP SCREEN: a tablet's (1.14: x.tablet), else -- a screen
    // from before -- the screen's
    sleepCtx(x) {
      var self = this;
      if (x.tablet) {
        var tid = x.tablet;
        return { key: tid, base: '#/house/tablets/' + encodeURIComponent(tid) + '/sleep', err: 't:sleep',
                 set: function (ch) { return self.setT(tid, ch); } };
      }
      return { key: x.path, base: '#/screens/' + encodeURIComponent(x.path) + '/sleep', err: 'b:sleep',
               set: function (ch) { return self.setB(x.path, ch); } };
    }
    s_sleep(c, x, b) {
      var self = this, ctx = this.sleepCtx(x), base = ctx.base, wide = this.hasAttribute('wide');
      var sl = b.sleep || {}, hk = sl.decided_by === 'hk' || sl.decided_by === 'shadow';
      var put = function (ch) { return ctx.set({ sleep: Object.assign({}, sl, ch) }); };
      var ids = (this.data.screensavers || {})[ctx.key] || {};
      var choices = (this.data.choices || {}).sleep || {};
      var mins = function (m) { return m < 60 ? m + ' min' : (m / 60) + (m === 60 ? ' hour' : ' hours'); };
      var secs = function (v) { return v === 0 ? 'None' : v < 60 ? v + ' s' : mins(v / 60); };
      c.appendChild(K.group({ header: 'Going Dark', footer: 'Drawn By: Kiosk Satellite puts its own Black screensaver up; ' + PN() + ' draws the black on this page and turns the backlight down itself, then fades back in with it (Kiosk Satellite’s is its fallback). ' +
          'While Dark: a display that is off has no glow at all, but a tap cannot wake it — the power button, the doorbell or somebody walking in can.' }, [
        K.seg({ label: 'Drawn By', sk: 'b:black_screen', stack: !wide, value: b.black_screen || 'kiosk',
                options: [['kiosk', 'Kiosk Satellite'], ['hk', PN()]], onChange: function (v) { ctx.set({ black_screen: v }); } }),
        K.seg({ label: 'While Dark', sk: 'b:sleep.dark_display', stack: !wide, value: sl.dark_display || 'lowest',
                options: [['lowest', 'Lowest Backlight'], ['off', 'Display Off'], ['off_quiet', 'Off in Quiet Hours']],
                onChange: function (v) { put({ dark_display: v }); } })]));
      var sw = b.black_switch || ids.black, sens = ids.sleep;
      c.appendChild(K.group({ header: 'Decided By', footer: sl.decided_by === 'shadow'
          ? 'Trying it out: ' + PN() + ' decides by the rules below but does not act yet' + (sens ? ' — ' + sens + ' shows what it would do, and why.' : '.') + ' Choose ' + PN() + ' to let it.'
          : hk ? PN() + ' sleeps and wakes this tablet itself, by the rules below' + (sens ? ' — ' + sens + ' says what it decides, and why.' : '.')
          : 'An automation of yours decides: it turns ' + (sw || 'the tablet’s black screen switch') + ' on to sleep and off to wake — the Set black screen action also takes the brightness to wake to. Nothing here makes the tablet sleep by itself.' }, [
        K.seg({ label: 'Decided By', sk: 'b:sleep.decided_by', stack: !wide, value: hk ? 'hk' : 'automation',
                options: [['automation', 'An Automation'], ['hk', PN()]], onChange: function (v) { put({ decided_by: v }); } })]));
      if (hk) {
        var ks = (this.data.choices || {}).kiosks || [];
        var kfoot = 'The tablet’s Kiosk Satellite: how ' + PN() + ' powers its display, sets its brightness, brings the dashboard back in front, and knows another app is in front (it then leaves the tablet alone).';
        if (x.tablet) {
          // the tablet's own Kiosk App and Device (its page's Setup)
          var kd = ks.filter(function (k) { return k.id === sl.kiosk; })[0];
          c.appendChild(K.group({ header: 'Kiosk', footer: kfoot + (kd ? '' : ' Choose it on the tablet’s page: Kiosk App, Kiosk Satellite, and its Device.') }, [
            K.nav({ label: 'Kiosk Satellite', value: kd ? kd.name : 'None', sk: 't:sleep.kiosk',
                    href: '#/house/tablets/' + encodeURIComponent(x.tablet) })]));
        } else {
          c.appendChild(K.group({ header: 'Kiosk', footer: kfoot }, [
            K.select({ label: 'Kiosk Satellite', sk: 'b:sleep.kiosk', value: sl.kiosk || '',
                       options: [['', 'None']].concat(ks.map(function (k) { return [k.id, k.name]; })),
                       onChange: function (v) { put({ kiosk: v }); } })]));
        }
        var after = (choices.after_saver || [0, 15, 30, 60, 120]).map(function (m) { return [m, m ? 'After ' + mins(m) : 'Never']; });
        var sched = [K.select({ label: 'After the Screensaver', sk: 'b:sleep.after_saver', value: sl.after_saver || 0, options: after,
                                onChange: function (v) { put({ after_saver: Number(v) }); } }),
                     K.toggle({ label: 'Quiet Hours Schedule', sk: 'b:sleep.schedule', on: !!sl.schedule,
                                onChange: function (on) { put({ schedule: on }); } })];
        if (sl.schedule) {
          sched.push(K.text({ label: 'From', sk: 'b:sleep.quiet_from', value: sl.quiet_from, placeholder: '22:00', error: this.err(ctx.err),
                              onCommit: function (v) { put({ quiet_from: v.trim() }); } }));
          sched.push(K.text({ label: 'To', sk: 'b:sleep.quiet_to', value: sl.quiet_to, placeholder: '07:00',
                              onCommit: function (v) { put({ quiet_to: v.trim() }); } }));
        }
        sched.push(K.nav({ label: 'Quiet While', href: base + '/quiet', sk: 'b:sleep.quiet_while', value: self.sleepCount(sl.quiet_while) }));
        c.appendChild(K.group({ header: 'When It Goes Dark', footer: 'After the Screensaver: dark once the photos have shown that long with nobody touching it (with Presence, nobody new coming in). Quiet hours, by the clock and while anything in Quiet While is on: dark even with somebody in the room — a tap still wakes it.' }, sched));
        var linger = (choices.linger || [0, 30, 60, 120, 300]).map(function (v) { return [v, secs(v)]; });
        c.appendChild(K.group({ header: 'Who Is There', footer: 'Somebody in the room: the photos (a dark tablet wakes to the dashboard, and the photos follow on their own); somebody touching it: the dashboard; nobody: dark.' }, [
          K.nav({ label: 'Presence', href: base + '/presence', sk: 'b:sleep.presence', value: (sl.presence || []).length ? self.sleepCount(sl.presence) : 'Always Occupied' }),
          K.select({ label: 'Linger', sk: 'b:sleep.linger', value: sl.linger == null ? 60 : sl.linger, options: linger,
                     onChange: function (v) { put({ linger: Number(v) }); } }),
          K.nav({ label: 'Only While Lit', href: base + '/lit', sk: 'b:sleep.lit', value: self.sleepCount(sl.lit) }),
          K.nav({ label: 'Sleep Until Re-entered', href: base + '/reset', sk: 'b:sleep.reset', value: self.sleepCount(sl.reset) })]));
        c.appendChild(K.group({ header: 'Overrides', footer: 'In this order: Wake For, Hold While, Keep Awake While, Stay Dark While — all before who is in the room. Another app in front is always left alone.' }, [
          K.nav({ label: 'Wake For', href: base + '/wake', sk: 'b:sleep.wake_for', value: self.sleepCount(sl.wake_for) }),
          K.nav({ label: 'Hold While', href: base + '/hold', sk: 'b:sleep.hold_while', value: self.sleepCount(sl.hold_while) }),
          K.nav({ label: 'Keep Awake While', href: base + '/awake', sk: 'b:sleep.awake_while', value: self.sleepCount(sl.awake_while) }),
          K.nav({ label: 'Stay Dark While', href: base + '/dark', sk: 'b:sleep.dark_while', value: self.sleepCount(sl.dark_while) })]));
        // BRIGHTNESS: Day and Night, each its level (in %; the display's
        // 0-255 underneath), its start time when by the clock, and its list
        // that forces it -- Day While, then Night While, then the clock
        var bm = sl.brightness || 'leave';
        var bOpts = [['leave', 'Leave It'], ['fixed', 'Day and Night']];
        if (bm === 'sensor') bOpts.push(['sensor', 'From an Entity']);
        var pct = function (v) { return Math.max(1, Math.round((v || 0) / 2.55)); };
        var raw = function (p) { return Math.max(1, Math.min(255, Math.round(p * 2.55))); };
        c.appendChild(K.group({ header: 'Brightness', footer: bm === 'leave'
            ? PN() + ' never changes the screen’s brightness. (The tablet’s own adaptive brightness, if it is on, still does.)'
            : 'The screen’s brightness while awake, and what it wakes to — set on the screen itself, as Fully Kiosk did, and checked again at every sleep and wake. Under ' + PN() + '’s black the backlight stays at its lowest until the wake. Turn the tablet’s own adaptive brightness off, or the two will fight.' }, [
          K.seg({ label: 'Brightness', sk: 'b:sleep.brightness', stack: !wide, value: bm, options: bOpts,
                  onChange: function (v) { put({ brightness: v }); } })].concat(bm === 'fixed' ? [
          K.toggle({ label: 'Day and Night by the Clock', sk: 'b:sleep.bright_clock', on: !!sl.bright_clock,
                     onChange: function (on) { put({ bright_clock: on }); } })] : []).concat(bm === 'sensor' ? [
          this.entityRow({ label: 'Entity', sk: 'b:sleep.bright_sensor', value: sl.bright_sensor, title: 'Brightness From',
                           filter: { domains: ['sensor', 'input_number', 'number'] }, onPick: function (id) { put({ bright_sensor: id || '' }); } })] : [])));
        if (bm === 'fixed') {
          var clock = !!sl.bright_clock;
          c.appendChild(K.group({ header: 'Day', footer: (clock ? 'From ' + (sl.day_from || '07:00') + ', and always' : 'Whenever it is not night (below) — and always') + ' while anything in Day While is on.' }, [
            K.slider({ label: 'Brightness', sk: 'b:sleep.bright_day', min: 1, max: 100, unit: '%', value: pct(sl.bright_day || 174),
                       onChange: function (v) { put({ bright_day: raw(v) }); } })].concat(clock ? [
            K.text({ label: 'Starts At', sk: 'b:sleep.day_from', value: sl.day_from || '07:00', placeholder: '07:00', error: this.err(ctx.err),
                     onCommit: function (v) { put({ day_from: v.trim() }); } })] : []).concat([
            K.nav({ label: 'Day While', href: base + '/day', sk: 'b:sleep.day_while', value: self.sleepCount(sl.day_while) })])));
          c.appendChild(K.group({ header: 'Night', footer: (clock ? 'From ' + (sl.night_from || '22:00') + ', ' : 'Not by the clock: ') + 'whenever anything in Night While is on (Day While still wins).' }, [
            K.slider({ label: 'Brightness', sk: 'b:sleep.bright_night', min: 1, max: 100, unit: '%', value: pct(sl.bright_night || 75),
                       onChange: function (v) { put({ bright_night: raw(v) }); } })].concat(clock ? [
            K.text({ label: 'Starts At', sk: 'b:sleep.night_from', value: sl.night_from || '22:00', placeholder: '22:00',
                     onCommit: function (v) { put({ night_from: v.trim() }); } })] : []).concat([
            K.nav({ label: 'Night While', href: base + '/night', sk: 'b:sleep.night_while', value: self.sleepCount(sl.night_while) })])));
        }
      }
      var wk = docsLink('Sleep-Screen', '', { sub: 'Sleep Screen', sk: 'b:sleep:wiki' });
      if (wk) c.appendChild(K.group({ footer: 'How Sleep Screen works, and ready-made automations for deciding it yourself.' }, [wk]));
    }
    sleepCount(list) { var n = (list || []).length; return n ? n + (n === 1 ? ' Entity' : ' Entities') : 'None'; }
    // ONE OF SLEEP SCREEN'S LISTS: as many entities as the house has; Hold
    // While and Wake For say which of theirs also work in quiet hours
    s_sleep_list_t(c, x, tid, which) { return this.s_sleepList(c, x, this.tabs()[tid] || {}, which); }
    s_sleepList(c, x, b, which) {
      var self = this, ctx = this.sleepCtx(x), spec = SLEEP_LISTS[which], sl = b.sleep || {};
      var list = (sl[spec.key] || []).slice(), qok = (sl.quiet_ok || []).slice();
      var put = function (ch) { return ctx.set({ sleep: Object.assign({}, sl, ch) }); };
      var setList = function (v) {
        var ch = {}; ch[spec.key] = v;
        if (spec.quiet) ch.quiet_ok = qok.filter(function (id) { return v.indexOf(id) >= 0 || self.sleepElsewhere(sl, spec.key, id); });
        return put(ch);
      };
      c.appendChild(K.listEditor({ fk: 'sleep-' + which, announce: this.announce.bind(this), emptyText: 'None', shownHeader: spec.title, reorder: false,
        rows: list.map(function (id) { return { value: id, label: self.name(id), sub: id }; }),
        onChange: setList,
        addLabel: 'Add…', onAddOther: function () {
          self.go(self.picker('sleep-add-' + which, { title: 'Add to ' + spec.title, value: null, multi: true,
            items: function () {
              return self.entityIds({ domains: spec.domains, shown: true }).filter(function (id) { return list.indexOf(id) < 0; })
                .map(function (id) { return { value: id, label: self.name(id), sub: self.areaName(self.areaOf(id)) || id }; });
            },
            onPick: function (id) { if (id) setList(list.concat(id)); } }));
        } }));
      if (spec.quiet && list.length) {
        c.appendChild(K.group({ header: 'Also in Quiet Hours', footer: 'Ticked: works in quiet hours too (smoke, the doorbell). The rest wait until quiet hours end.' },
          list.map(function (id) {
            return K.check({ label: self.name(id), multi: true, on: qok.indexOf(id) >= 0, sk: 'b:sleep.quiet_ok:' + id,
              onClick: function (on) { put({ quiet_ok: on ? qok.concat(id) : qok.filter(function (q) { return q !== id; }) }); } });
          })));
      }
      c.appendChild(K.group({ footer: spec.help }, []));
    }
    // an entity also in the other quiet-capable list keeps its tick
    sleepElsewhere(sl, key, id) {
      var other = key === 'hold_while' ? 'wake_for' : 'hold_while';
      return (sl[other] || []).indexOf(id) >= 0;
    }
    // A SCREEN'S ROOMS: Same as All Screens (Rooms, on the sidebar), or this
    // screen's own -- its room order and Home's rooms, the menu's and the
    // pages'. Turning Same off starts from All Screens' as they are.
    s_rooms(c, x, b) {
      var self = this, set = function (ch) { return self.setB(x.path, ch); }, wide = this.hasAttribute('wide');
      var follows = !b.rooms_custom;
      var MENU = [['az', 'A to Z'], ['order', 'Room Order']], PAGES = [['floor', 'By Floor'], ['order', 'Room Order']];
      var label = function (opts, v) { return (opts.filter(function (o) { return o[0] === v; })[0] || [v, v])[1]; };
      c.appendChild(K.group({ footer: follows ? 'This screen’s rooms follow Rooms (All Screens). Turn this off to set them here, for this screen only.'
          : 'This screen sets its own. Turn this on to follow Rooms (All Screens) again.' }, [
        K.toggle({ label: 'Same as All Screens', sk: 'b:rooms_custom', on: follows, onChange: function (on) {
          if (!on) { set({ rooms_custom: true, room_order: (b.room_order || []).slice(), home_rooms: b.home_rooms,
                           menu_rooms: b.menu_rooms, page_rooms: b.page_rooms }); return; }
          self.confirmSwitch({ title: 'Follow All Screens’ Rooms?', message: 'This screen’s own room order and choices will be replaced.', ok: 'Follow All Screens' },
              function () { set({ rooms_custom: false }); });
        } })]));
      if (follows) {
        this.fromAllScreens(c, [
          K.info({ label: 'Room Order', value: M.roomsSummary(b) }),
          K.info({ label: 'Rooms in Menu', value: label(MENU, b.menu_rooms) })].concat(x.generated ? [
          K.info({ label: 'Rooms on Pages', value: label(PAGES, b.page_rooms) })] : []), 'Rooms', '#/house/rooms');
        return;
      }
      var az = this.areasAZ(), areas = this.client.areas || {};
      var mdl = M.roomsModel(b, az);
      c.appendChild(K.listEditor({ fk: 'rooms', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
        autoFooter: 'Automatic: Home shows its rooms as the screen lists them' + (x.generated ? ' (floor by floor, then A to Z).' : '.'),
        shownHeader: 'On Home', moreHeader: 'Not on Home',
        moreFooter: 'A room that isn’t on Home keeps its page and its row in the menu. Tap a room for its own settings, the same on every screen.',
        rows: mdl.rows.map(function (r) { return { value: r.value, label: self.areaName(r.value), icon: (areas[r.value] || {}).icon || 'mdi:texture-box', href: self.roomHref(r.value) }; }),
        more: mdl.more.map(function (r) { return { value: r.value, label: self.areaName(r.value), icon: (areas[r.value] || {}).icon || 'mdi:texture-box' }; }),
        onAuto: function (on) {
          if (!on) { set({ room_order: az.slice(), home_rooms: 'order' }); return; }
          self.confirmSwitch({ title: 'Use Automatic Rooms?', message: 'This screen’s room order and choices will be replaced.', ok: 'Use Automatic' },
              function () { set(M.roomsAuto()); });
        },
        onChange: function (v) { set(M.roomsSave(v, az)); } }));
      c.appendChild(K.group({ header: 'Menu and Pages', footer: 'Room Order is the order above.' }, [
        K.seg({ label: 'Rooms in Menu', sk: 'b:menu_rooms', value: b.menu_rooms, stack: !wide, options: MENU,
                onChange: function (v) { set({ menu_rooms: v }); } })].concat(x.generated ? [
        K.seg({ label: 'Rooms on Pages', sub: 'Lights, Climate, Water and the other pages that group by room.', sk: 'b:page_rooms',
                value: b.page_rooms, stack: !wide, options: PAGES, onChange: function (v) { set({ page_rooms: v }); } })] : [])));
    }
    // THE ENERGY FEATURE IS ADDED: its page (and its page pill) exist
    energyOn() {
      var feats = (this.data && this.data.features) || {};
      return !!(feats.hk_energy && (feats.hk_energy.entries || []).length);
    }
    // THE POWER PAGE IS ON (the Energy plan has one): its page kind exists
    powerOn() {
      var E = this.energyOn() && window.hkSettings && window.hkSettings.get('energy', null);
      return !!(E && E.power);
    }
    // WHAT A SCREEN SHOWS (hk-settings-model.js onlySummary): null for a
    // whole screen; for one with no Home page, its pages in a few words
    onlyOf(b) {
      var d = this.data || {}, custom = {};
      (d.custom_pages || []).forEach(function (p) { custom[p.path] = p.title; });
      var energyOn = this.energyOn(), powerOn = this.powerOn();
      if (energyOn) delete custom.energy;
      var kinds = (d.page_kinds || []).filter(function (k) { return (k !== 'energy' || energyOn) && (k !== 'power' || powerOn); });
      return M.onlySummary(b, kinds, custom, energyOn, function (k) { return custom[k] !== undefined ? custom[k] : (M.PAGE_LABELS[k] || k); });
    }
    // HOME PAGE OFF / ON: asked first, and said what changes. The two lists
    // are apart (only_pages / pages), so either way the other is kept.
    setHomePage(path, on) {
      var self = this;
      return this.confirmSwitch(on
        ? { title: 'Make It a Whole Screen?', ok: 'Whole Screen',
            message: 'Its Home page, its rooms and its other pages come back, as they were. The pages it shows now are kept, for if you turn Home Page off again.' }
        : { title: 'Show Only Some Pages?', ok: 'Only Some Pages',
            message: 'This screen will have no Home page and no room pages — only the pages you pick next, opening on the first. ' +
                     'Until you pick one it still shows everything. Nothing is deleted: turn Home Page back on to get the whole screen back.' },
        function () {
          return self.setB(path, { home_page: !!on }).then(function () {
            if (!on) self.go('#/screens/' + encodeURIComponent(path) + '/pages');
            return true;
          });
        });
    }
    dwInSecurity(b) { return !!this.hs('security.alarm') && M.screenShows(b, 'security'); }
    s_pages(c, x, b) {
      var self = this, set = function (ch) { return self.setB(x.path, ch); };
      var custom = {};
      (this.data.custom_pages || []).forEach(function (p) { custom[p.path] = p.title; });
      // THE ENERGY PAGE: with the Energy feature, the generated page has the
      // address `energy` -- a custom page there is not a page of its own
      // (hk-strategy.js shows the generated one); without it, no Energy page
      // to offer
      var energyOn = this.energyOn(), powerOn = this.powerOn();
      var homeCustom = Object.assign({}, custom);
      custom = Object.assign({}, custom);
      if (energyOn) delete custom.energy;
      var kinds = (this.data.page_kinds || []).filter(function (k) { return (k !== 'energy' || energyOn) && (k !== 'power' || powerOn); });
      // DOORS & WINDOWS IS SECURITY'S where the house has an alarm and this
      // screen shows Security (hk-strategy.js withSecurity): no page of its own
      if (this.dwInSecurity(b)) kinds = kinds.filter(function (k) { return k !== 'doors_windows'; });
      var lab = function (k) { return custom[k] !== undefined ? custom[k] : (M.PAGE_LABELS[k] || k); };
      // HOME PAGE: off, the screen is only the pages it lists -- any of them
      var om = b.home_page === false ? M.onlyModel(b, kinds, custom, energyOn) : null;
      var firstOnly = om && om.rows.length ? lab(om.rows[0].value) : null;
      c.appendChild(K.group({ footer: b.home_page === false
          ? (firstOnly ? 'This screen is only these pages, and opens on ' + firstOnly + '.'
                       : 'Add a page below: with none, the screen is a whole screen as usual.')
          : 'Off: the screen is only the pages you pick, and opens on the first — the Energy page alone, say, or Security and Cameras.' }, [
        K.toggle({ label: 'Home Page', sk: 'b:home_page', on: b.home_page !== false,
                   sub: b.home_page === false ? 'Off: only the pages below' : 'On: a whole screen',
                   onChange: function (on) { self.setHomePage(x.path, on); } })]));
      // WHICH HOME: the generated one, or one of the house's custom pages, with
      // the screen's other pages generated as usual (a car's own first page)
      if (b.home_page !== false && Object.keys(homeCustom).length) {
        var hv = b.home_view && homeCustom[b.home_view] !== undefined ? b.home_view : '';
        c.appendChild(K.group({ footer: hv
            ? 'The screen opens on ' + homeCustom[hv] + '; its other pages are generated as usual.'
            : 'A custom page can be this screen’s Home, with its other pages generated as usual — a car’s own first page, say.' }, [
          K.select({ label: 'Home', sk: 'b:home_view', value: hv,
                     options: [['', 'Generated']].concat(Object.keys(homeCustom).map(function (k) { return [k, homeCustom[k]]; })),
                     onChange: function (v) { set({ home_view: v }); } })]));
      }
      if (om) {
        var subOf = function (r) { return r.custom ? 'Custom page' : r.value === 'rooms' ? 'A page for every room' : null; };
        var hrefOf = function (r) {
          return r.custom ? '#/pages/' + encodeURIComponent(r.value) : r.value === 'energy' ? '#/page/energy' : null;
        };
        c.appendChild(K.listEditor({ fk: 'opages', minRows: 0, announce: this.announce.bind(this), shownHeader: 'This Screen Shows Only',
          emptyText: 'No pages yet — add one from More. Until then the screen shows everything.',
          shownFooter: 'In this order; the screen opens on the first. Any page a generated screen can have, and your custom pages.',
          rows: om.rows.map(function (r) {
            return { value: r.value, label: lab(r.value), sub: subOf(r), href: hrefOf(r) };
          }),
          more: om.more.map(function (r) { return { value: r.value, label: lab(r.value), sub: subOf(r) }; }),
          onChange: function (v) { set({ only_pages: v }); } }));
        return;
      }
      var mdl = M.pagesModel(b, kinds, custom);
      var keys = mdl.rows.map(function (r) { return r.value; });
      var menuOn = b.menu !== 'off';
      // WHERE EACH PAGE SITS IN THE MENU: top (right under
      // Home), Categories, or not in the menu -- its row's own pop-up menu
      var items = M.menuItems(keys, custom);
      var placeCtl = function (k) {
        var p = M.menuPathOf(k, custom);
        if (!p || !menuOn) return null;
        var it = items.filter(function (y) { return y.path === p; })[0];
        return K.popup({ label: lab(k) + ' in the menu', options: M.MENU_PLACES, value: M.placeOf(b, it, items),
                         fk: 'place:' + k, onChange: function (v) {
            var ch = M.placeSet(b, items, p, v);
            if (!ch) { self.announce('Categories keeps at least one page: move it to the top, or use the automatic menu.'); self.render(); return; }
            set(ch);
          } });
      };
      c.appendChild(K.listEditor({ fk: 'pages', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
        autoFooter: 'Automatic: every page the house has something for, in the usual order.',
        shownFooter: menuOn ? 'Top of Menu: right under Home, above Categories. Not in Menu: still one tap away on its chip. ' +
          'The order here is the menu’s order.' : 'This screen has no menu (Menu is Off).',
        rows: mdl.rows.map(function (r) {
          return { value: r.value, label: lab(r.value),
                   sub: r.custom ? 'Custom page' : null, removable: r.custom,
                   href: r.custom ? '#/pages/' + encodeURIComponent(r.value) : null,
                   control: placeCtl(r.value), value2: menuOn && M.MENU_FIXED[r.value] && !r.fixed ? M.MENU_FIXED[r.value] : null };
        }),
        more: mdl.more.filter(function (r) { return !mdl.auto || r.custom; })
          .map(function (r) { return { value: r.value, label: lab(r.value), sub: r.custom ? 'Custom page' : null }; }),
        onAuto: function (on) {
          if (!on) { set(M.pagesSave(mdl.rows.map(function (r) { return r.value; }), custom)); return; }
          self.confirmSwitch({ title: 'Use Automatic Pages?', message: 'This screen’s page order and choices will be replaced.', ok: 'Use Automatic' },
              function () { set({ pages: [] }); });
        },
        onAdd: mdl.auto ? function (v) { set(M.pagesCustom(b, v, true)); } : null,
        onRemove: function (v) { set(M.pagesCustom(b, v, false)); },
        onChange: function (v) { set(M.pagesSave(v, custom)); } }));
      if (menuOn && ((b.menu_top || []).length || (b.categories || []).length)) {
        c.appendChild(K.group({ footer: 'Automatic: Weather, Cameras and Live TV at the top, every other page under Categories.' }, [
          K.button({ label: 'Reset to Automatic Menu', fk: 'menu:auto', onClick: function () { set({ menu_top: [], categories: [] }); } })]));
      }
      c.appendChild(K.group({ footer: h('span', {}, ['Custom pages are written in ',
        h('a', { href: '#/pages', text: 'Custom Pages' }), '.']) }, []));
    }
    // THE GLASS STYLE, All Screens' or a screen's (2026-10-10): Glass,
    // Frosted or Blur, and -- while Blur is chosen -- how it blurs (Blur
    // Mode), each with what it costs. `cur`: the stored value shown as
    // chosen (null: none -- a screen following All Screens); `fallback`: the
    // blur mode Blur starts from; `pick(v)` saves; `fk` prefixes the keys.
    glassChoices(c, cur, fallback, pick, fk, header) {
      var style = cur ? M.glassStyle(cur) : null;
      c.appendChild(K.group({ header: header || 'Style' }, M.GLASS_STYLES.map(function (g) {
        return K.check({ label: g[1], sub: g[2], on: style === g[0], fk: fk + g[0], onClick: function () {
          // Blur keeps the mode already chosen
          pick(g[0] === 'blur' ? (M.isBlur(cur) ? cur : fallback) : g[0]);
        } });
      })));
      if (style !== 'blur') return;
      c.appendChild(K.group({ header: 'Blur Mode', footer: 'Shared Layer and Each Card blur live; Pre-rendered blurs a picture of the sky once. ' +
          'On a wall tablet, anything but Each Card. Pop-up sheets blur live in Shared Layer and Pre-rendered.' }, M.BLUR_MODES.map(function (m) {
        return K.check({ label: m[1], sub: m[2], on: cur === m[0], fk: fk + 'mode:' + m[0], onClick: function () { pick(m[0]); } });
      })));
    }
    s_glass(c, x, b) {
      var self = this, look = this.data.settings.look;
      var pick = function (v) {
        self.setB(x.path, v === 'flat' ? { flat: true } : v === 'house' ? { flat: null, glass: 'house' } : { flat: false, glass: v });
      };
      var gl = M.glassOf(b, look), follows = !gl.own;
      c.appendChild(K.group({ footer: 'Same as All Screens follows All Screens → Appearance, so this screen changes with the others.' }, [
        K.check({ label: 'Same as All Screens', sub: 'Now ' + M.glassLabel(gl.house), on: follows, fk: 'glass:house',
                  onClick: function () { pick('house'); } })]));
      // Blur here starts from All Screens' mode when theirs is a blur too
      this.glassChoices(c, follows ? null : gl.value, M.isBlur(look.glass) ? look.glass : 'blur', pick, 'glass:', 'Just This Screen');
    }

    // AN OPTIONS PAGE: OPTION_PAGES' controls over the options mapping, then
    // the way to the rest of it in YAML
    // THE SCREENSAVER'S OPTIONS (HK Frontend's own, hk-saver.js). Every
    // control saves the whole set; the defaults are settings.py's.
    // A SCREEN'S SCREENSAVER OPTIONS: the settings for All Screens (the
    // default -- `screensaver_options` null), or its own.
    // WHAT IS SAVED: only the options Home Assistant's running HK Frontend
    // knows (the keys of All Screens' options, which it fills in). These
    // files are served the moment they change, its Python only after a
    // restart: a new option sent to an older one had every save refused
    // (Fade Back, 2026-10-04).
    saverKnown(k) {
      var h = this.hs('look.saver');
      return !h || typeof h !== 'object' || Object.prototype.hasOwnProperty.call(h, k);
    }
    saverOut(o) {
      var self = this, out = {};
      Object.keys(o).forEach(function (k) { if (self.saverKnown(k)) out[k] = o[k]; });
      return out;
    }
    // one option saved, for a screen of its own or for All Screens
    saverPutB(path) {
      var self = this;
      return function (k, v) {
        var b = (self.data.boards || {})[path] || {}, o = M.saverOptions(b.screensaver_options);
        if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
        return self.setB(path, { screensaver_options: self.saverOut(o) });
      };
    }
    saverPutH() {
      var self = this;
      return function (k, v) {
        var o = M.saverOptions(self.hs('look.saver'));
        if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
        return self.setH({ 'look.saver': self.saverOut(o) });
      };
    }
    // CLOCK STYLE (2026-10-13): the fourteen faces, the preview showing the
    // one chosen -- the same style for Show: Clock and a Large clock
    saverStyle(c, cur, put) {
      var cr = this.clockColorRow(cur, put);
      if (cr) c.appendChild(K.group({ footer: 'Each style keeps its own color.' }, [cr]));
      c.appendChild(K.group({ footer: 'The same style for Show: Clock and a Large clock over the photos or the forecast. Every style shows the date.' },
        M.CLOCK_STYLES.map(function (st) {
          return K.check({ label: st[1], sub: st[2], on: (cur.clock_style || 'classic') === st[0], fk: 'saver:clock_style:' + st[0],
                           onClick: function () { put('clock_style', st[0]); } });
        })));
    }
    saverPage(c, x, b, path) {
      var self = this, house = M.saverFollows(b);
      var cur = M.saverOptions(house ? this.hs('look.saver') : b.screensaver_options);
      c.appendChild(K.group({ footer: house
          ? 'This screen uses the screensaver settings for All Screens (All Screens → Screensaver). Off: it gets its own, starting from these.'
          : 'This screen has its own screensaver settings. On: it uses the settings for All Screens again.' }, [
        K.toggle({ label: 'Same as All Screens', sk: 'saver:house', on: house, onChange: function (on) {
          self.setB(path, { screensaver_options: on ? null : self.saverOut(cur) });
        } })].concat(house ? [K.nav({ label: 'Screensaver for All Screens', value: M.saverSummary(cur),
                                      href: '#/house/screensaver', sk: 'saver:house-page' })] : [])));
      // THE HOST'S OWN, for this screen's screensaver (extend): nothing in Home Assistant
      var hx = this.host();
      if (hx && typeof hx.extend === 'function') {
        try { hx.extend('saver', c, { screen: path, title: x.title }, this); } catch (e) { /* the host's own group */ }
      }
      if (!house) {
        this.saverGroups(c, cur, function (k, v) {
          var o = M.saverOptions(cur); if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
          return self.setB(path, { screensaver_options: self.saverOut(o) });
        }, '#/screens/' + encodeURIComponent(path) + '/screensaver/clock-style', b.idle_room ? this.areaName(b.idle_room) : x.title);
        if (M.saverCustom(cur)) {
          c.appendChild(K.group({}, [K.button({ label: 'Reset to Defaults…', destructive: true, fk: 'saver:reset', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Use the default screensaver options?', message: 'Every option on this page goes back to its default.',
                                         ok: 'Use Defaults', destructive: true }).then(function (yes) {
              if (yes) self.setB(path, { screensaver_options: self.saverOut(M.saverOptions(null)) });
            });
          } })]));
        }
      }
      c.appendChild(this.saverEntities(b, path));
      if (x.generated) this.engineGroup(c, b, path);
    }
    // THE OPTIONS THEMSELVES, for a screen of its own or for All Screens:
    // `cur` the options in force, `put(key, value)` saves one.
    saverGroups(c, cur, put, styleHref, room) {
      var self = this;
      var sel = function (label, k, choices, sub) {
        var opts = choices.map(function (n) { return [String(n), MIN(n)]; });
        if (!choices.some(function (n) { return n === cur[k]; })) opts.push([String(cur[k]), MIN(cur[k])]);
        return K.select({ label: label, sub: sub, value: String(cur[k]), options: opts, sk: 'saver:' + k,
                          onChange: function (v) { put(k, Number(v)); } });
      };
      var tog = function (label, k, sub) {
        return K.toggle({ label: label, sub: sub, on: !!cur[k], sk: 'saver:' + k, onChange: function (on) { put(k, on); } });
      };
      // ONE TIMER: Starts After also decides how long a touch keeps the screen
      // In Use (a minute less, never under 15 s -- screensaver.py window_of)
      var win = Math.max(15, cur.starts_after - 60);
      // WHAT IT SHOWS (2026-10-10): the photos -- with slides between them,
      // the forecast and the music -- or the forecast, the music over it
      // while it plays. Stored as before: show is photos, both (the forecast
      // slide on) or forecast; music_slide beside it.
      var fc = cur.show === 'forecast', both = cur.show === 'both';
      // SHOW: CLOCK (2026-10-13): the clock is the screensaver; what is
      // behind it is its own choice -- below, in its own groups
      var ckKnown = self.saverKnown('clock_style'), ck = ckKnown && cur.show === 'clock';
      var styleName = (M.CLOCK_STYLES.filter(function (x) { return x[0] === (cur.clock_style || 'classic'); })[0] || [0, 'Classic'])[1];
      var muKnown = self.saverKnown('music_slide'), mu = muKnown && !!cur.music_slide;
      var every = function (n) { return 'Every ' + n + ' Photos'; };
      if (ck) { this.saverClockGroups(c, cur, put, styleHref, styleName, tog, room); return; }
      c.appendChild(K.group({ header: 'Show', footer: fc
          ? 'The forecast over the live sky and the season’s landscape: today, the next hours and the coming days. No photos needed.'
          : cur.fallback ? 'Your photos. When the photos folder has none, or can’t be read, the forecast shows instead.'
          : 'Your photos. When the photos folder has none, or can’t be read, the screen stays dark.' }, [
        K.seg({ label: 'Show', value: fc ? 'forecast' : 'photos', sk: 'saver:show',
                options: [['photos', 'Photos'], ['forecast', 'Forecast']].concat(ckKnown ? [['clock', 'Clock']] : []),
                onChange: function (v) { put('show', v === 'forecast' || v === 'clock' ? v : 'photos'); } })
      ].concat(fc ? [] : [tog('Forecast When There Are No Photos', 'fallback')],
               // the details ON the forecast, wherever a forecast can show
               (fc || both || cur.fallback) ? [tog('Details on the Forecast', 'band',
                 'On the forecast: today, the next hours and the coming days along the bottom. Off: the sky and the landscape alone.')] : [])));
      // MUSIC FIRST (music_first; with Forecast, the older music_slide over
      // it is the same): while music plays it fills the screen
      var mfKnown = self.saverKnown('music_first'), mf = (mfKnown && !!cur.music_first) || (fc && mu);
      // THE SLIDES between the photos (the music's only when it isn't first)
      // HOME ENERGY (2026-10-14): a slide among the photos too
      var enKnown = self.saverKnown('energy_slide'), en = enKnown && !!cur.energy_slide;
      var energyHref = String(styleHref || '').replace(/clock-style$/, 'energy');
      var weatherHref = String(styleHref || '').replace(/clock-style$/, 'weather');
      if (!fc) {
        var muSlide = mu && !mf;
        var wxKnown = self.saverKnown('weather_slide'), wx = wxKnown && !!cur.weather_slide;
        var turns = [muSlide && 'the music', both && 'the forecast', wx && 'the weather', en && 'Home Energy'].filter(Boolean);
        c.appendChild(K.group({ header: 'Between the Photos', footer: turns.length
            ? 'After every few photos a slide fades in for as long as a photo shows, then the photos go on.' +
              (turns.length > 1 ? ' ' + M.listText(turns).replace(/^t/, 'T') + ' take turns.' : '') +
              (muSlide ? ' The music only while something plays; its buttons skip or pause without closing the screensaver, and a tap on its album art opens Music.' : '') +
              (en ? ' Home Energy skips its turn until it has the day’s numbers; a tap on it opens Energy.' : '')
            : 'Slides among the photos: the forecast' + (mf ? '' : ', what’s playing') + (wxKnown ? ', the weather' : '') + (enKnown ? ', and Home Energy.' : '.') }, [
          K.toggle({ label: 'Forecast', sub: 'The forecast over the live sky, as one of the photos. Its sky only moves while it is on screen.',
                     on: both, sk: 'saver:slide_forecast', onChange: function (on) { put('show', on ? 'both' : 'photos'); } })
        ].concat(muKnown && !mf ? [tog('Music', 'music_slide', 'What’s playing, full screen: the album art, the song and what’s up next, with buttons for the previous or next song.')] : [],
                 wxKnown ? this.weatherRows(cur, tog, weatherHref) : [],
                 enKnown ? this.energyRows(cur, tog, energyHref) : [],
                 turns.length ? [K.select({ label: 'A Slide', sk: 'saver:forecast_every', value: String(cur.forecast_every),
                                    options: [3, 5, 10, 20].concat([3, 5, 10, 20].indexOf(cur.forecast_every) < 0 ? [cur.forecast_every] : [])
                                      .map(function (n) { return [String(n), every(n)]; }),
                                    onChange: function (v) { put('forecast_every', Number(v)); } })] : [])));
      }
      if (fc && enKnown) this.saverExtras(c, cur, put, tog, 'forecast', mf, energyHref);
      if (mfKnown || (fc && muKnown)) {
        c.appendChild(K.group({ header: 'While Music Plays', footer: mf
            ? 'While music plays anywhere in the house, the album art fills the screen in place of the ' + (fc ? 'forecast' : 'photos') +
              ', with the song, what’s up next and its buttons (they skip or pause without closing the screensaver; a tap on the art opens Music). The ' +
              (fc ? 'forecast' : 'photos') + ' come back 20 seconds after the music stops.'
            : 'Off: the ' + (fc ? 'forecast stays' : 'photos go on') + ' while music plays' + (fc ? '.' : (mu ? ', the music as one of the slides.' : '.')) }, [
          K.toggle({ label: 'Music First', sub: 'The music fills the screen while it plays.', on: mf, sk: 'saver:music_first',
                     onChange: function (on) {
                       // (the older Forecast switch, music_slide over it, is folded in)
                       if (!mfKnown) { put('music_slide', on); return; }
                       put(fc ? { music_first: on, music_slide: false } : { music_first: on });
                     } })]));
      }
      // BACK TO THE DASHBOARD (hk-saver.js stop): a touch or the switch
      var FADES = [[0, 'Instant'], [500, '0.5 Seconds'], [1000, '1 Second'], [2000, '2 Seconds']];
      var fadeOpts = FADES.concat(FADES.some(function (f) { return f[0] === cur.fade_back; }) ? []
        : [[cur.fade_back, (cur.fade_back / 1000) + ' Seconds']]);
      c.appendChild(K.group({ header: 'Timing', footer: 'Starts After is the one timer. The screen also counts as In Use for ' + MIN(win).toLowerCase() +
          ' after each touch (a minute less than Starts After), so the photos never come up while someone is using it, and an automation reading ' +
          'In Use never disagrees with the screensaver.' }, [
        sel('Starts After', 'starts_after', [60, 120, 180, 300, 600, 900, 1800], 'Untouched for this long.')].concat(
          fc ? [] : [sel('Each Photo For', 'each_photo', [10, 20, 30, 60, 120, 300])],
          !self.saverKnown('fade_back') ? [] : [K.select({ label: 'Fade Back', sub: 'From the screensaver to the dashboard, after a touch or when the switch turns off.',
                      value: String(cur.fade_back), sk: 'saver:fade_back',
                      options: fadeOpts.map(function (f) { return [String(f[0]), f[1]]; }),
                      onChange: function (v) { put('fade_back', Number(v)); } })])));
      if (!fc) this.saverPhotoGroups(c, cur, put, tog, false);
      var overPhotos = fc ? [] : [tog('Forecast Along the Bottom', 'band_photos', 'Today, the next hours and the coming days, along the bottom of the photos.')];
      c.appendChild(K.group({ header: fc ? 'On the Screen' : 'Over the Photos', footer: fc
          ? 'The forecast is the weather set in Weather; today’s conditions are in it, so the Weather line isn’t needed.'
          : 'The photos come from Screensaver Photos (All Screens → Screensaver).' }, [
        ckKnown ? K.seg({ label: 'Clock', sub: cur.clock === false ? 'No clock' : cur.clock_over === 'large' ? 'Your Clock Style, centered' : 'Small, top left, with the date',
                          sk: 'saver:clock_over', value: cur.clock === false ? 'off' : cur.clock_over === 'large' ? 'large' : 'corner',
                          options: [['corner', 'Corner'], ['large', 'Large'], ['off', 'Off']],
                          onChange: function (v) { put(v === 'off' ? { clock: false } : { clock: true, clock_over: v }); } })
                : tog('Clock & Date', 'clock')].concat(
          ckKnown && cur.clock !== false && cur.clock_over === 'large'
            ? [K.nav({ label: 'Clock Style', value: styleName, href: styleHref, sk: 'saver:clock_style' }), this.clockColorRow(cur, put)]
                .concat(this.clockNightRows(cur, put), fc ? [] : this.clockTextRows(cur, put)).filter(Boolean) : [],
          fc ? [] : [tog('Weather', 'weather')], [
        tog('Now Playing', 'music', 'Music playing anywhere in the house, bottom left.'),
        tog('Timers', 'timers', 'Running timers, bottom right.'),
        tog('Home Status', 'status', 'Top right: Home Secured when the alarm is armed and everything is shut, or what’s open or unlocked. Nothing when there’s nothing to say.')], overPhotos)));
      // THE PANE down the right: the coming events, what plays, or both --
      // the calendar above the music -- the photos (or the forecast) beside it
      var days = function (n) { return n === 1 ? 'Today' : n === 2 ? 'Today & Tomorrow' : n + ' Days'; };
      var pmKnown = self.saverKnown('music_pane'), pm = pmKnown && !!cur.music_pane, what = fc ? 'forecast' : 'photos';
      c.appendChild(K.group({ header: 'Side Pane', footer: cur.calendar && pm
          ? 'Down the right of the screen, Home Status at its top: the calendar’s events, and below them what’s playing while music plays. The ' + what + ' move over beside it. A swipe on the events scrolls them; the music’s buttons skip or pause; a touch anywhere else closes the screensaver.'
          : cur.calendar
          ? 'The events of the calendars in Pages → Calendar, down the right of the screen, with Home Status at its top; the ' +
            what + ' move over beside it. A swipe on it scrolls it; a touch anywhere else closes the screensaver.'
          : pm ? 'While music plays, what’s playing down the right of the screen, with Home Status at its top; the ' + what +
            ' move over beside it, with the next photo. Its buttons skip or pause without closing the screensaver, and a tap on its album art opens Music. 20 seconds after the music stops, the pane goes.'
          : 'Down the right of the screen: the coming events, what’s playing, or both.' }, [
        tog('Calendar', 'calendar')].concat(cur.calendar ? [K.select({ label: 'Days', sk: 'saver:calendar_days',
          value: String(cur.calendar_days), options: [1, 2, 3, 4, 5, 6, 7].map(function (n) { return [String(n), days(n)]; }),
          onChange: function (v) { put('calendar_days', Number(v)); } })] : [],
          pmKnown ? [tog('Music', 'music_pane')] : [])));
    }
    // HOME ENERGY'S ROWS (2026-10-14): its switch, and its options once on
    energyRows(cur, tog, href) {
      var rows = [tog('Home Energy', 'energy_slide', 'Today so far: energy, cost and water against a usual day.')];
      if (cur.energy_slide) rows.push(K.nav({ label: 'Home Energy Options', value: M.energyShown(cur), href: href, sk: 'saver:energy_options' }));
      return rows;
    }
    // WEATHER'S ROWS (2026-10-14): its switch, and its options once on
    weatherRows(cur, tog, href) {
      var rows = [tog('Weather', 'weather_slide', 'Today’s weather at a glance, over the live sky.')];
      if (cur.weather_slide) rows.push(K.nav({ label: 'Weather Options', value: M.weatherShown(cur), href: href, sk: 'saver:weather_options' }));
      return rows;
    }
    // WEATHER'S OPTIONS (2026-10-14; hk-saver-weather.js): the readings, and
    // what is along the bottom. The preview holds the screen.
    saverWeather(c, cur, put) {
      var hide = Array.isArray(cur.weather_hide) ? cur.weather_hide : [];
      var part = function (k, label, sub) {
        return K.toggle({ label: label, sub: sub, on: hide.indexOf(k) < 0, sk: 'saver:weather_hide:' + k,
          onChange: function (on) {
            var next = hide.filter(function (x) { return x !== k; });
            if (!on) next.push(k);
            put('weather_hide', M.WEATHER_PARTS.filter(function (x) { return next.indexOf(x) >= 0; }));
          } });
      };
      c.appendChild(K.group({ header: 'Readings', footer: 'Temperature always shows: now, with today’s high and low. Each reading has its leader line and a line in words underneath. Rain reads Snow when it snows.' }, [
        part('rain', 'Rain', 'The chance today, and when.'),
        part('wind', 'Wind', 'Its speed, direction and gusts.')]));
      c.appendChild(K.group({ header: 'Along the Bottom', footer: 'From the weather in Weather, as the forecast’s details have them. Behind it all, the live sky as it is outside (Sky Only). A tap on the screen opens the Weather page.' }, [
        part('hours', 'Next Hours'), part('days', 'Coming Days')]));
    }
    // ADDITIONAL SCREENS (2026-10-14): over the forecast or the clock, now
    // and then -- the forecast (on Show: Clock), the music and Home Energy,
    // taking turns on one timer. `mf`: Music First, which covers the music
    saverExtras(c, cur, put, tog, base, mf, href) {
      var rows = [], bgSky = cur.clock_bg === 'forecast' || cur.clock_bg === 'skyonly';
      if (base === 'clock' && !bgSky) rows.push(tog('Forecast', 'extra_forecast', 'Today, the next hours and the coming days, over the live sky.'));
      if (!mf) rows.push(tog('Music', 'extra_music', 'What’s playing, full screen. Only while something plays; otherwise it skips its turn.'));
      // (Weather over the clock; over the forecast it is the weather already)
      var wxOn = base === 'clock' && this.saverKnown('weather_slide');
      if (wxOn) rows = rows.concat(this.weatherRows(cur, tog, String(href).replace(/energy$/, 'weather')));
      rows = rows.concat(this.energyRows(cur, tog, href));
      var on = [base === 'clock' && !bgSky && cur.extra_forecast && 'the forecast', !mf && cur.extra_music && 'the music',
                wxOn && cur.weather_slide && 'the weather', cur.energy_slide && 'Home Energy'].filter(Boolean);
      var mins = function (n) { return n === 1 ? '1 Minute' : n + ' Minutes'; };
      var secs = function (n) { return n < 60 ? n + ' Seconds' : n === 60 ? '1 Minute' : (n % 60 ? Math.round(n / 6) / 10 : n / 60) + ' Minutes'; };
      if (on.length) {
        var EV = [1, 2, 5, 10, 15, 30], FOR = [15, 30, 60, 120];
        rows.push(K.select({ label: 'Every', sk: 'saver:extra_every', value: String(cur.extra_every),
          options: EV.concat(EV.indexOf(cur.extra_every) < 0 ? [cur.extra_every] : []).map(function (n) { return [String(n), mins(n)]; }),
          onChange: function (v) { put('extra_every', Number(v)); } }));
        rows.push(K.select({ label: 'Show For', sk: 'saver:extra_for', value: String(cur.extra_for),
          options: FOR.concat(FOR.indexOf(cur.extra_for) < 0 ? [cur.extra_for] : []).map(function (n) { return [String(n), secs(n)]; }),
          onChange: function (v) { put('extra_for', Number(v)); } }));
      }
      c.appendChild(K.group({ header: 'Additional Screens', footer: on.length
          ? 'Every ' + mins(cur.extra_every).toLowerCase() + ', ' + (on.length > 1 ? 'one of these' : on[0]) + ' fades in over the ' + base +
            ' for ' + secs(cur.extra_for).toLowerCase() + ', then the ' + base + ' comes back.' +
            (on.length > 1 ? ' ' + M.listText(on).replace(/^t/, 'T') + ' take turns, so each comes around every ' + mins(cur.extra_every * on.length).toLowerCase() + '.' : '') +
            ' They wait while music plays first' + (base === 'clock' ? ' and during Night Mode.' : '.') +
            (mf ? ' Music First covers the music, so it isn’t listed here.' : '')
          : 'Other screens, now and then, over the ' + base + '.' + (mf ? ' Music First covers the music.' : '') }, rows));
    }
    // HOME ENERGY'S OPTIONS (2026-10-14; hk-saver-energy.js): which rings,
    // what is along the bottom, the month. The preview holds the screen.
    saverEnergy(c, cur, put) {
      var self = this, hide = Array.isArray(cur.energy_hide) ? cur.energy_hide : [];
      var src = this.energySources();
      var part = function (k, label, sub) {
        return K.toggle({ label: label, sub: sub, on: hide.indexOf(k) < 0, sk: 'saver:energy_hide:' + k,
          onChange: function (on) {
            var next = hide.filter(function (x) { return x !== k; });
            if (!on) next.push(k);
            put('energy_hide', M.ENERGY_PARTS.filter(function (x) { return next.indexOf(x) >= 0; }));
          } });
      };
      var rings = [part('cost', 'Cost', null), part('water', 'Water', null)];
      if (src && src.solar) rings.push(part('solar', 'Solar', null));
      if (src && src.gas) rings.push(part('gas', 'Gas', null));
      c.appendChild(K.group({ header: 'Rings', footer: 'Energy always shows. Each ring is today so far against a usual whole day; the white dot is where a usual day is by this time. A ring shows only where Home Assistant’s Energy settings have it.' }, rings));
      c.appendChild(K.group({ header: 'Right Now', footer: 'Along the bottom, left. Each shows only where there is one: House Battery needs a house battery on the Energy page.' }, [
        part('power', 'Power Now', 'What the house draws right now.'),
        part('battery', 'House Battery', 'Its charge.'),
        part('yday', 'Yesterday by Now', 'Yesterday’s use up to this time.')]));
      var mo = hide.indexOf('month') < 0, cost = hide.indexOf('cost') < 0;
      var also = ' The numbers are the Energy page’s Today and This Month, up to the last five minutes. A tap on Home Energy opens the Energy page.';
      c.appendChild(K.group({ header: 'This Month', footer: (!mo ? 'Off: today only.'
          : 'Along the bottom, right: the month since the 1st, for each ring that shows.' + (cost && hide.indexOf('pace') < 0
            ? ' Heading for is the Energy page’s own estimate: what the month has cost so far, plus a usual day for each day left. It firms up as the month goes on.' : '')) + also },
        [part('month', 'Month So Far', 'Energy, cost and water since the 1st.')].concat(mo && cost ? [part('pace', 'Where the Cost Is Heading', 'The month’s cost so far, plus a usual day’s for each day left.')] : [])));
    }
    // WHICH SOURCES THE HOUSE HAS (Home Assistant's Energy settings), for
    // Home Energy's rings: asked once, the page drawn again when they land
    energySources() {
      var self = this;
      if (this._enSrc !== undefined) return this._enSrc;
      this._enSrc = null;
      var client = this.client;
      if (client && client.callWS) {
        client.callWS({ type: 'energy/get_prefs' }).then(function (pr) {
          var t = {};
          ((pr && pr.energy_sources) || []).forEach(function (x) { t[x.type] = true; });
          self._enSrc = t;
          self.render();
        }).catch(function () { /* the rings it always has */ });
      }
      return null;
    }
    // THE CLOCK'S COLOR (2026-10-13): the chosen style's own colors; each
    // face keeps its own (clock_colors), so trying another style loses none
    clockColorRow(cur, put) {
      var style = cur.clock_style || 'classic', set = M.CLOCK_COLORS[style] || [];
      if (!set.length || !this.saverKnown('clock_colors')) return null;
      var mine = (cur.clock_colors || {})[style], val = set.some(function (c) { return c[0] === mine; }) ? mine : set[0][0];
      return K.select({ label: 'Color', sub: 'This style’s own colors', sk: 'saver:clock_color', value: val,
        options: set.map(function (c, i) { return [c[0], c[1] + (i ? '' : ' (Default)'), c[1]]; }),
        onChange: function (v) { var o = Object.assign({}, cur.clock_colors || {}); o[style] = v; put('clock_colors', o); } });
    }
    // SHOW: CLOCK's groups (2026-10-13): the clock, what's behind it, and
    // what's over it -- each corner its own switch, so it can be the clock
    // alone
    // NIGHT MODE's rows: Off / At Night / Always, and the night's hours
    clockNightRows(cur, put) {
      if (!this.saverKnown('clock_night')) return [];
      var self = this, mode = cur.clock_night || 'off', rows = [
        K.seg({ label: 'Night Mode', sub: 'A dim red clock on black, as StandBy has it', sk: 'saver:clock_night', value: mode, stack: !this.hasAttribute('wide'),
                options: [['off', 'Off'], ['night', 'At Night'], ['always', 'Always']], onChange: function (v) { put('clock_night', v); } })];
      if (mode === 'night') {
        var hhmm = function (label, k, dflt) {
          return K.text({ label: label, sk: 'saver:' + k, value: cur[k] || dflt, placeholder: dflt, maxlength: 5, error: self.err('look.saver'),
                          onCommit: function (v) { v = v.trim(); if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) put(k, v); else self.render(); } });
        };
        rows.push(hhmm('From', 'clock_night_from', '22:00'), hhmm('Until', 'clock_night_to', '07:00'));
      }
      return rows;
    }
    // THE PHOTOS' OWN SETTINGS (Layout, the mosaic, Order, Slow Zoom, then
    // Portrait and Landscape): the Photo Screensaver's -- and, the same rows,
    // the clock's when Photos is behind it (2026-10-13, the user: mimic them)
    saverPhotoGroups(c, cur, put, tog, clockMode) {
      var self = this, wideP = this.hasAttribute('wide');
      // THE MOSAIC (2026-10-13): 2-5 photos at once, in a layout picked at
      // random; portraits in the tall cells
      var moKnown = self.saverKnown('photo_layout'), mo = moKnown && cur.photo_layout === 'mosaic';
      var prow = [];
      if (moKnown) prow.push(K.seg({ label: 'Layout', sk: 'saver:photo_layout', value: mo ? 'mosaic' : 'single', stack: !wideP,
        options: [['single', 'One at a Time'], ['mosaic', 'Mosaic']], onChange: function (v) { put('photo_layout', v); } }));
      var upTo = mo && self.saverKnown('mosaic_random') && !!cur.mosaic_random;
      if (mo) {
        prow.push(K.seg({ label: upTo ? 'Up to' : 'Photos per Mosaic', sk: 'saver:mosaic_count', value: String(cur.mosaic_count || 3),
          options: [['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']], onChange: function (v) { put('mosaic_count', Number(v)); } }));
        if (self.saverKnown('mosaic_random')) {
          prow.push(K.toggle({ label: 'Up To', sub: 'A different number of photos now and then — from one, full screen, up to this many.',
                               on: upTo, sk: 'saver:mosaic_random', onChange: function (on) { put('mosaic_random', on); } }));
          if (upTo) {
            var EV = [1, 5, 10, 15, 30, 60], ev = cur.mosaic_every || 10;
            prow.push(K.select({ label: 'A New Number Every', sk: 'saver:mosaic_every', value: String(ev),
              options: EV.concat(EV.indexOf(ev) < 0 ? [ev] : []).map(function (m) { return [String(m), m === 1 ? '1 Minute' : m + ' Minutes']; }),
              onChange: function (v) { put('mosaic_every', Number(v)); } }));
          }
        }
        prow.push(K.seg({ label: 'Spacing', sk: 'saver:mosaic_gap', value: cur.mosaic_gap || 'thin', stack: !wideP,
          options: [['none', 'None'], ['thin', 'Thin'], ['rounded', 'Rounded']], onChange: function (v) { put('mosaic_gap', v); } }));
        if ((cur.mosaic_gap || 'thin') !== 'none' && self.saverKnown('mosaic_line')) {
          var lw = cur.mosaic_line > 0 ? cur.mosaic_line : (cur.mosaic_gap === 'rounded' ? 12 : 3);
          prow.push(K.slider({ label: 'Line Thickness', sk: 'saver:mosaic_line', value: lw, min: 1, max: 24, unit: ' px',
                               onChange: function (v) { put('mosaic_line', v); } }));
          prow.push(K.select({ label: 'Line Color', sk: 'saver:mosaic_color', value: cur.mosaic_color || 'black',
            options: [['black', 'Black'], ['white', 'White'], ['gray', 'Gray'], ['charcoal', 'Charcoal'], ['cream', 'Cream'], ['navy', 'Navy']],
            onChange: function (v) { put('mosaic_color', v); } }));
        }
        prow.push(K.seg({ label: 'Changes', sk: 'saver:mosaic_change', value: cur.mosaic_change === 'all' ? 'all' : 'one', stack: !wideP,
          options: [['one', 'One Photo at a Time'], ['all', 'All at Once']], onChange: function (v) { put('mosaic_change', v); } }));
      }
      prow.push(K.seg({ label: 'Order', value: cur.order, sk: 'saver:order', options: [['random', 'Random'], ['sorted', 'In Order']],
                        onChange: function (v) { put('order', v); } }));
      if (clockMode) {
        var EP = [10, 20, 30, 60, 120, 300], ep = cur.each_photo;
        prow.push(K.select({ label: 'Each Photo For', sk: 'saver:each_photo', value: String(ep),
          options: EP.concat(EP.indexOf(ep) < 0 ? [ep] : []).map(function (n) { return [String(n), MIN(n)]; }),
          onChange: function (v) { put('each_photo', Number(v)); } }));
      }
      prow.push(tog('Slow Zoom', 'zoom', 'A slow zoom across each photo. The tablet keeps drawing the whole time, so it runs warmer.'));
      c.appendChild(K.group({ header: 'Photos', footer: (mo
          ? (upTo ? 'Up To: a new number of photos every ' + (cur.mosaic_every || 10) + ' minutes, one of them full screen now and then. ' : '') +
            'A new layout each time, picked at random — portraits in the tall cells, landscapes in the wide ones. One Photo at a Time changes one cell every ' +
            MIN(cur.each_photo).toLowerCase() + ', and after a while the whole mosaic. '
          : '') + (clockMode ? 'The same settings as the Photo Screensaver’s, for the photos behind the clock.'
          : 'Tap the left or right edge of the screensaver for the previous or next ' + (mo ? 'mosaic' : 'photo') + ', or the forecast details for the Weather page; anywhere else closes it.') }, prow));
      this.saverShape(c, cur, put, 'portrait', mo);
      this.saverShape(c, cur, put, 'landscape', mo);
    }
    // THE CLOCK'S TEXT OVER PHOTOS (2026-10-13): how much it stands out
    clockTextRows(cur, put) {
      if (!this.saverKnown('clock_text_shadow')) return [];
      return [K.slider({ label: 'Shadow', sk: 'saver:clock_text_shadow', value: cur.clock_text_shadow != null ? cur.clock_text_shadow : 40,
                         min: 0, max: 100, step: 5, unit: '%', onChange: function (v) { put('clock_text_shadow', v); } }),
              K.slider({ label: 'Outline', sk: 'saver:clock_text_outline', value: cur.clock_text_outline || 0,
                         min: 0, max: 100, step: 5, unit: '%', onChange: function (v) { put('clock_text_outline', v); } })];
    }
    saverClockGroups(c, cur, put, styleHref, styleName, tog, room) {
      var self = this, bg = cur.clock_bg || 'gradient', wide = this.hasAttribute('wide');
      var bgRow = M.CLOCK_BGS.filter(function (x) { return x[0] === bg; })[0] || M.CLOCK_BGS[2];
      c.appendChild(K.group({ header: 'Show', footer: 'A clock, full screen, over the background you choose.' }, [
        K.seg({ label: 'Show', value: 'clock', sk: 'saver:show', options: [['photos', 'Photos'], ['forecast', 'Forecast'], ['clock', 'Clock']],
                onChange: function (v) { put('show', v); } })]));
      // A CLOCK FOR THE ROOM: offered while the clock isn't it already
      var rec = M.clockRecommend(room), recSet = rec.set;
      var recNow = Object.keys(recSet).every(function (k) { return (cur[k] || (k === 'clock_night' ? 'off' : '')) === recSet[k]; });
      if (!recNow && self.saverKnown('clock_night')) {
        var rName = (M.CLOCK_STYLES.filter(function (st) { return st[0] === recSet.clock_style; })[0] || [0, ''])[1];
        var bName = (M.CLOCK_BGS.filter(function (b2) { return b2[0] === recSet.clock_bg; })[0] || [0, ''])[1];
        c.appendChild(K.group({ header: room ? 'Recommended for ' + room : 'Recommended', footer: rec.says + '. You can change any of it after.' }, [
          K.button({ label: 'Use ' + rName + ' on ' + bName + (recSet.clock_night === 'night' ? ', Red at Night' : ''), sk: 'saver:clock_rec',
                     onClick: function () { put(Object.assign({}, recSet)); } })]));
      }
      c.appendChild(K.group({ header: 'Clock', footer: (cur.clock_style === 'today' ? 'Today shows the weather and what\u2019s playing itself: the corners\u2019 Weather and Now Playing step aside. ' : '') +
          'Every style shows the date. On a screen left on all night, the clock drifts a little every few minutes, so nothing burns in.' }, [
        K.nav({ label: 'Style', value: styleName, href: styleHref, sk: 'saver:clock_style' }),
        self.clockColorRow(cur, put),
        tog('24-Hour Time', 'clock_24')].concat(self.clockNightRows(cur, put)).filter(Boolean)));
      var brows = [K.select({ label: 'Background', sk: 'saver:clock_bg', value: bg,
        options: M.CLOCK_BGS.map(function (x) { return [x[0], x[1]]; }),
        onChange: function (v) { put('clock_bg', v); } })];
      // SPEED AND DEPTH (2026-10-13): every background moves but Black --
      // how fast (0: still, for a tablet that runs warm) and how strong
      if (bgRow[2] && self.saverKnown('clock_speed')) {
        var spd = cur.clock_speed != null ? cur.clock_speed : (cur.clock_motion === 'still' ? 0 : 35);
        brows.push(K.slider({ label: 'Speed', sub: spd ? null : 'Still: it changes once a minute', sk: 'saver:clock_speed', value: spd, min: 0, max: 100, step: 5, unit: '%',
                              onChange: function (v) { put({ clock_speed: v, clock_motion: v ? 'slow' : 'still' }); } }));
        brows.push(K.slider({ label: 'Depth', sub: 'How strong it is: the colors, the glow, the relief', sk: 'saver:clock_depth', value: cur.clock_depth != null ? cur.clock_depth : 50,
                              min: 0, max: 100, step: 5, unit: '%', onChange: function (v) { put('clock_depth', v); } }));
      }
      var bfoot = { forecast: 'The forecast’s live sky and the season’s land behind the clock.',
                    skyonly: 'The live sky alone, as it is outside: clouds, stars, the moon, rain and snow — no land, trees or decorations.',
                    photos: cur.clock_photo_soft ? 'Your photos, blurred and darkened behind it, changing every ' + MIN(cur.each_photo).toLowerCase() + '.'
                      : 'Your photos behind it, laid out as Photos (below) says, darkened so the clock reads.',
                    landscapes: 'Fifty photos of mountains, lakes, coasts, deserts and forests, one after another behind the clock' + (cur.clock_photo_soft ? ', blurred and darkened.' : ', darkened so the clock reads.'),
                    sky: 'The live sky’s colors as they are now, with no stars or weather.' }[bg] ||
                  (bgRow[2] ? 'Drawn on the tablet itself and moved smoothly: a new frame about once a second, blended into the last (Constellation draws every frame). Speed 0 holds it still.' : 'Plain black: nothing moves.');
      // PHOTOS BEHIND IT (2026-10-13): sharp, as the Photo Screensaver shows
      // them, or Soft (the blurred copies); darkened by their own amount
      if ((bg === 'photos' || bg === 'landscapes') && self.saverKnown('clock_photo_dim')) {
        brows.push(K.seg({ label: 'Photos', sk: 'saver:clock_photo_soft', value: cur.clock_photo_soft ? 'soft' : 'sharp', stack: !wide,
                           options: [['sharp', 'Sharp'], ['soft', 'Soft']], onChange: function (v) { put('clock_photo_soft', v === 'soft'); } }));
        brows.push(K.slider({ label: 'Darken', sk: 'saver:clock_photo_dim', value: cur.clock_photo_dim != null ? cur.clock_photo_dim : 35,
                              min: 0, max: 80, step: 5, unit: '%', onChange: function (v) { put('clock_photo_dim', v); } }));
      }
      c.appendChild(K.group({ header: 'Behind the Clock', footer: bfoot }, brows));
      if (bg === 'photos' || bg === 'landscapes') {
        var ctr = self.clockTextRows(cur, put);
        if (ctr.length) c.appendChild(K.group({ header: 'Clock Text', footer: 'How much the clock stands out from the photos: a soft shadow under it, and a dark outline around it.' }, ctr));
        self.saverPhotoGroups(c, cur, put, tog, true);
      }
      var over = [tog('Weather', 'weather', 'Top left: the temperature and conditions.'),
                  tog('Now Playing', 'music', 'Music playing anywhere in the house, bottom left.'),
                  tog('Timers', 'timers', 'Running timers, bottom right.'),
                  tog('Home Status', 'status', 'Top right: Home Secured, or what’s open or unlocked.')];
      if (bg === 'forecast' || bg === 'skyonly') over.push(tog('Forecast Details', 'band', 'Today, the next hours and the coming days, along the bottom.'));
      else over.push(tog('Forecast Along the Bottom', 'band_photos', 'Today, the next hours and the coming days, along the bottom.'));
      if (self.saverKnown('energy_slide')) self.saverExtras(c, cur, put, tog, 'clock', !!cur.music_first, String(styleHref || '').replace(/clock-style$/, 'energy'));
      c.appendChild(K.group({ header: 'Over the Clock', footer: 'Each is your choice: turn them all off for the clock alone.' }, over));
      // the side pane: the clock moves over beside it, as the photos do
      c.appendChild(K.group({ header: 'Side Pane', footer: 'Down the right of the screen: the coming events, what’s playing, or both. The clock moves over beside it.' },
        [tog('Calendar', 'calendar')].concat(self.saverKnown('music_pane') ? [tog('Music', 'music_pane')] : [])));
      if (self.saverKnown('music_first')) c.appendChild(K.group({ header: 'While Music Plays', footer: cur.music_first
          ? 'While music plays anywhere in the house, the album art fills the screen in place of the clock, with the song and its buttons, and the time small above it. The clock comes back 20 seconds after the music stops.'
          : 'Off: the clock stays while music plays.' }, [
        K.toggle({ label: 'Music First', sub: 'The music fills the screen while it plays.', on: !!cur.music_first, sk: 'saver:music_first',
                   onChange: function (on) { put({ music_first: on }); } })]));
      var opts = [60, 120, 180, 300, 600, 900, 1800].map(function (n) { return [String(n), MIN(n)]; });
      if (!opts.some(function (o) { return o[0] === String(cur.starts_after); })) opts.push([String(cur.starts_after), MIN(cur.starts_after)]);
      c.appendChild(K.group({ header: 'Timing' }, [K.select({ label: 'Starts After', sub: 'Untouched for this long.', value: String(cur.starts_after), sk: 'saver:starts_after',
        options: opts, onChange: function (v) { put('starts_after', Number(v)); } })]));
    }
    // PORTRAIT OR LANDSCAPE PHOTOS (2026-10-13), each their own: Whole (over
    // a blurred copy: its Blur and Dim) or Fill the Screen, a Zoom, and the
    // Focus -- which part stays when it's cropped, or where a whole one sits.
    // A change here turns the preview to a photo of that shape.
    saverShape(c, cur, put, side, mosaic) {
      var self = this, P = side === 'portrait';
      if (!this.saverKnown(side + '_zoom')) return;    // Home Assistant not restarted yet
      var k = function (x) { return side + '_' + x; };
      var fillKey = P ? 'portrait_fill' : 'fill', fill = P ? !!cur.portrait_fill : cur.fill !== false;
      var set = function (key, v) {
        if (self._saverShape !== side) { self._saverShape = side; self.saverPreview(true); }
        put(key, v);
      };
      // (in a mosaic every photo fills its cell: Show As and the copy behind
      // a whole one don't apply -- the Zoom and Focus do, in each cell)
      if (mosaic) fill = true;
      var rows = mosaic ? [] : [K.seg({ label: 'Show As', sk: 'saver:' + fillKey, value: fill ? 'fill' : 'whole', options: [['whole', 'Whole'], ['fill', 'Fill the Screen']],
                          onChange: function (v) { set(fillKey, v === 'fill'); } })];
      if (!fill) {
        rows.push(K.slider({ label: 'Background Blur', sub: 'The blurred copy around it', sk: 'saver:' + k('blur'), value: cur[k('blur')], min: 0, max: 100, step: 5, unit: '%',
                             onChange: function (v) { set(k('blur'), v); } }));
        rows.push(K.slider({ label: 'Background Dim', sk: 'saver:' + k('dim'), value: cur[k('dim')], min: 0, max: 80, step: 5, unit: '%',
                             onChange: function (v) { set(k('dim'), v); } }));
      }
      rows.push(K.slider({ label: 'Zoom', sk: 'saver:' + k('zoom'), value: cur[k('zoom')], min: 100, max: 200, step: 5, unit: '%',
                           onChange: function (v) { set(k('zoom'), v); } }));
      var cropped = fill || cur[k('zoom')] > 100;
      rows.push(K.seg({ label: cropped ? 'Focus' : 'Position', sub: 'Up and down', sk: 'saver:' + k('y'), value: cur[k('y')] || 'center',
                        options: [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']], onChange: function (v) { set(k('y'), v); } }));
      rows.push(K.seg({ label: cropped ? 'Focus' : 'Position', sub: 'Side to side', sk: 'saver:' + k('x'), value: cur[k('x')] || 'center',
                        options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], onChange: function (v) { set(k('x'), v); } }));
      var def = P ? { portrait_fill: false } : { fill: true };
      def[k('blur')] = 50; def[k('dim')] = 20; def[k('zoom')] = 100; def[k('x')] = 'center'; def[k('y')] = 'center';
      var custom = Object.keys(def).some(function (x) { return cur[x] !== def[x]; });
      if (custom) rows.push(K.button({ label: 'Reset to Default', sk: 'saver:' + side + ':default', onClick: function () { set(def); } }));
      c.appendChild(K.group({ header: P ? 'Portrait Photos' : 'Landscape Photos', footer: mosaic
          ? 'In the mosaic each photo fills its cell; Focus is the part that stays' + (P ? ' — Top keeps faces in most portraits' : '') + ', and Zoom closes in on it.'
          : (fill
          ? 'Fill the Screen crops it to the screen’s shape; Focus is the part that stays' + (P ? ' — Top keeps faces in most portraits.' : '.')
          : 'Whole: all of it, over a blurred copy of itself; Position is where it sits when there’s room around it.') +
        ' Zoom closes in on the ' + (cropped ? 'focus' : 'position') + '. Choose ' + (P ? 'Portrait' : 'Landscape') + ' above the preview to see one.' }, rows));
    }
    // ALL SCREENS' SCREENSAVER (All Screens → Screensaver): every screen whose
    // Same as All Screens is on uses these. The preview shows the first such
    // screen's screensaver.
    h_saver(c) {
      var self = this, cur = M.saverOptions(this.hs('look.saver')), boards = this.data.boards || {};
      var savers = Object.keys(boards).filter(function (p) { return boards[p].screensaver; });
      var follow = savers.filter(function (p) { return M.saverFollows(boards[p]); });
      // THE PHOTOS (2026-10-09: on Wall Tablets before), first
      c.appendChild(K.group({ header: 'Photos', footer: 'A media folder (media-source://…) of the photos every screen’s Photo Screensaver shows.' }, [
        K.text({ label: 'Screensaver Photos', sk: 'look.photos', value: this.hs('look.photos'), placeholder: 'media-source://…', error: this.err('look.photos'),
                 onCommit: function (v) { self.setH({ 'look.photos': v }); } })]));
      // THE HOST'S OWN beside the photos (extend): nothing in Home Assistant
      var hx = this.host();
      if (hx && typeof hx.extend === 'function') {
        try { hx.extend('house-saver', c, { photos: this.hs('look.photos'), set: function (v) { return self.setH({ 'look.photos': v }); } }, this); } catch (e) { /* the host's own group */ }
      }
      this.saverGroups(c, cur, function (k, v) {
        var o = M.saverOptions(cur); if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
        return self.setH({ 'look.saver': self.saverOut(o) });
      }, '#/house/screensaver/clock-style');
      var name = function (p) { return (self.dash(p) || { title: p }).title; };
      c.appendChild(K.group({ header: 'Screens', footer: savers.length
          ? 'A screen with its own settings keeps them; turn on Same as All Screens on its Screensaver Options to use these.'
          : 'No screen has Photo Screensaver on yet (a screen’s Behavior).' },
        savers.map(function (p) {
          var own = follow.indexOf(p) < 0;
          return K.nav({ label: name(p), value: own ? 'Just This Screen' : 'Same as All Screens',
                         href: '#/screens/' + encodeURIComponent(p) + '/screensaver', sk: 'saver:screen:' + p });
        })));
      if (M.saverCustom(cur)) {
        c.appendChild(K.group({}, [K.button({ label: 'Reset to Defaults…', destructive: true, fk: 'saver:house-reset', onClick: function () {
          K.confirm(self.shadowRoot, { title: 'Use the default screensaver options?', message: 'The settings for All Screens go back to their defaults.',
                                       ok: 'Use Defaults', destructive: true }).then(function (yes) {
            if (yes) self.setH({ 'look.saver': self.saverOut(M.saverOptions(null)) });
          });
        } })]));
      }
    }
    // FOR AUTOMATIONS: the screen's own switch and in-use sensor, which HK
    // Frontend makes for it (screensaver.py) -- nothing to create by hand
    saverEntities(b, path) {
      var self = this, mine = (b.tablets || []).filter(function (tid) { return self.tabs()[tid]; });
      if (!mine.length) {
        return K.group({ header: 'For Automations', footer: 'Add the wall tablet that shows this screen (Wall Tablets) and ' + haName('HK Frontend') + ' adds its screensaver switch and In Use sensor.' }, []);
      }
      var row = function (label, id, sub) {
        if (!id) return K.info({ label: label, sub: sub, value: 'Being added…' });
        var a = K.nav({ label: label, sub: id, href: '#', sk: 'saver:ent:' + id, value: self.stateLabel(id) });
        a.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          window.hkShell.moreInfo(id, self);
        });
        return a;
      };
      var rows = [];
      mine.forEach(function (tid) {
        var e = (self.data.screensavers || {})[tid] || {}, nm = mine.length > 1 ? self.tabs()[tid].name + ': ' : '';
        rows.push(row(nm + 'Photo Screensaver', e['switch'], 'On while the photos show'));
        rows.push(row(nm + 'In Use', e.in_use, 'Touched within its window'));
      });
      var room = b.idle_room, leg = room && this.client && this.client.states['input_boolean.wallpanel_screensaver_' + room];
      return K.group({ header: 'For Automations', footer: 'Each wall tablet’s own. Photo Screensaver is on while the photos show: turn it on to start them now ' +
          '(bedtime, say), off to close them (the doorbell). In Use is on while the tablet was touched within its window.' +
          (leg ? ' The older input_boolean.wallpanel_screensaver_' + room + ' follows it both ways until you delete it.' : '') }, rows);
    }
    stateLabel(id) {
      var st = this.client && this.client.states[id];
      return st ? (st.state === 'on' ? 'On' : st.state === 'off' ? 'Off' : st.state) : '';
    }
    // HEADER & SIDEBAR: what HK Frontend hides (hk-kiosk.js) -- and, on a
    // generated screen where the Kiosk Mode plugin is installed (or already
    // chosen), the plugin instead, with its own options page.
    kioskPage(c, x, b, path) {
      var self = this, base = '#/screens/' + encodeURIComponent(path);
      var set = function (o) { return self.setB(path, o); };
      var plugin = x.generated && b.kiosk_engine === 'kiosk_mode';
      // ON OR OFF first; what is hidden, and how, only while on
      c.appendChild(K.group({ footer: b.kiosk ? null : 'When this screen is shown in Home Assistant, Home Assistant’s own header and sidebar show around it.' }, [
        K.toggle({ label: 'Hide Header & Sidebar', sk: 'b:kiosk', on: b.kiosk, onChange: function (on) { set({ kiosk: on }); } })]));
      if (!b.kiosk) return;
      if (!plugin) {
        c.appendChild(K.group({ footer: 'Whatever is hidden, the menu’s Home Assistant section still reaches Home Assistant ' +
            '(Show Menu opens its sidebar). To see them on one visit, add ?\u2060hk_kiosk=off to the screen’s address.' +
            (x.generated ? '' : ' This dashboard’s own YAML can say it instead (hk_kiosk), and then that is used; ' +
             'if it has a kiosk_mode block, the Kiosk Mode plugin does it and these do nothing.') }, [
          K.toggle({ label: 'Hide Header', sub: 'The bar along the top with the dashboard’s name, its views and its menu.',
                     sk: 'b:kiosk_header', on: b.kiosk_header !== false, onChange: function (on) { set({ kiosk_header: on }); } }),
          K.toggle({ label: 'Hide Sidebar', sk: 'b:kiosk_sidebar', on: b.kiosk_sidebar !== false,
                     onChange: function (on) { set({ kiosk_sidebar: on }); } }),
          K.toggle({ label: 'For Admins Too', sub: 'Off: someone signed in as an admin still sees them.',
                     sk: 'b:kiosk_admins', on: b.kiosk_admins !== false, onChange: function (on) { set({ kiosk_admins: on }); } })]));
      }
      if (!x.generated) return;
      var tp = (this.data.thirdparty || {}).kiosk || {};
      if (!plugin && (!tp.state || tp.state === 'missing')) return;
      var rows = [K.toggle({ label: 'Use the Kiosk Mode Plugin Instead', sk: 'b:kiosk_engine', on: plugin, onChange: function (on) {
        set({ kiosk_engine: on ? 'kiosk_mode' : 'hk' });
      } })];
      if (plugin) rows.push(K.nav({ label: 'Kiosk Mode Options', href: base + '/kiosk-mode', sk: 'b:kiosk_options',
                                    value: Object.keys(b.kiosk_options || {}).length ? 'Custom' : 'Default' }));
      c.appendChild(K.group({ header: 'Kiosk Mode Plugin', footer: plugin
        ? 'The Kiosk Mode plugin (HACS) hides them on this screen, with its own options. Off: ' + PN() + ' does it.' +
          (tp.state !== 'ready' && tp.note ? ' ' + tp.note : '')
        : PN() + ' hides them itself. The Kiosk Mode plugin (HACS) can do it instead, for its own options.' }, rows));
    }
    // WALLPANEL INSTEAD: only where WallPanel (HACS) is installed, for a screen
    // that prefers it; its own options page then takes over.
    engineGroup(c, b, path) {
      var self = this, tp = (this.data.thirdparty || {}).wallpanel || {};
      var wp = b.screensaver_engine === 'wallpanel';
      if (!wp && (!tp.state || tp.state === 'missing')) return;
      c.appendChild(K.group({ header: 'WallPanel', footer: wp
        ? 'WallPanel (HACS) draws this screen’s screensaver, with the options below. Off: ' + PN() + '’s own.'
        : 'Draw this screen’s screensaver with WallPanel (HACS) instead of ' + PN() + '’s own.' }, [
        K.toggle({ label: 'Use WallPanel Instead', on: wp, sk: 'b:screensaver_engine', onChange: function (on) {
          self.setB(path, { screensaver_engine: on ? 'wallpanel' : 'hk' }).then(function () {
            self.go('#/screens/' + encodeURIComponent(path) + (on ? '/wallpanel' : '/screensaver'));
          });
        } })]));
    }
    optionsPage(c, spec, cur, save, yamlHref, tp) {
      var self = this;
      if (tp && tp.state && tp.state !== 'ready') c.appendChild(K.group({ footer: tp.note }, []));
      spec.groups.forEach(function (g, gi) {
        var rows = g.rows.map(function (r, ri) {
          var fk = 'opt:' + (r.key || r.fk || gi + '-' + ri), v = optGet(r, cur);
          var put = function (nv) { save(optSet(r, cur, nv)); };
          if (r.type === 'switch') return K.toggle({ label: r.label, sub: r.sub, on: !!v, sk: fk, onChange: put });
          if (r.type === 'seg') return K.seg({ label: r.label, sub: r.sub, value: v, options: r.options, sk: fk, onChange: put });
          var opts = r.options.map(function (op) { return [String(op[0]), op[1]]; });
          if (v !== '' && !opts.some(function (op) { return op[0] === String(v); })) opts.push([String(v), String(v)]);
          return K.select({ label: r.label, sub: r.sub, value: String(v), options: opts, sk: fk, onChange: put });
        });
        c.appendChild(K.group({ header: g.header, footer: gi === spec.groups.length - 1 ? spec.footer : null }, rows));
      });
      var n = Object.keys(cur || {}).length;
      c.appendChild(K.group({ header: 'More', footer: 'Any other option the card has, written in YAML.' }, [
        K.nav({ label: 'Options in YAML', value: n ? n + ' Set' : 'None', href: yamlHref, sk: 'opt:yaml' })]));
      if (n) {
        c.appendChild(K.group({}, [K.button({ label: 'Reset to Tuned Setup…', destructive: true, fk: 'opt:reset', onClick: function () {
          K.confirm(self.shadowRoot, { title: 'Use the tuned setup?', message: 'Every option changed here and in YAML goes back.',
                                       ok: 'Use Tuned Setup', destructive: true }).then(function (yes) { if (yes) save({}); });
        } })]));
      }
    }
    // A YAML PAGE: the options as written, Save / Revert / Use Default
    yamlPage(c, o) {
      var self = this, cur = o.value || {}, valid = true;
      if (o.example) {
        var ex = K.group({ header: 'For Example', footer: o.docs ? h('span', {}, ['Every option: ',
          h('a', { href: o.docs, target: '_blank', rel: 'noopener', text: 'the card’s documentation' }), '.']) : null }, []);
        ex.querySelector('.cells').appendChild(h('pre', { class: 'ex', text: o.example }));
        c.appendChild(ex);
        var dl = ex.querySelector('.gf a'); if (dl) dl.setAttribute('href', o.docs);
      }
      var box = h('div', { class: 'yaml' });
      // what to write goes under the editor, with the group's other notes
      // (not in the page-subtitle style: after other groups that sat at the
      // page's margin, out of line with every footer)
      var grp = K.group({ footer: [o.help, o.note].filter(Boolean).join(' ') || null }, []);
      grp.querySelector('.cells').replaceWith(box);
      c.appendChild(grp);
      var err = this.err(o.sk);
      if (err) c.appendChild(h('div', { class: 'errline', role: 'alert', text: err }));
      var saveBtn = K.button({ label: o.saveLabel || 'Save', fk: o.sk + ':save', onClick: function () {
        if (!valid) { self.announce('The YAML has a mistake.'); return; }
        o.onSave(cur && typeof cur === 'object' ? cur : {});
      } });
      var rows = [saveBtn];
      if (o.clear !== false && Object.keys(o.value || {}).length) {
        rows.push(K.button({ label: 'Reset to Default Options…', destructive: true, fk: o.sk + ':clear', onClick: function () {
          K.confirm(self.shadowRoot, { title: 'Use the default options?', message: 'What’s written here will be removed.',
                                       ok: 'Use Default', destructive: true }).then(function (yes) { if (yes) o.onSave({}); });
        } }));
      }
      c.appendChild(K.group({}, rows));
      // THE KIT'S YAML EDITOR (Phase 2 P2.4; Home Assistant's before): the
      // value written out, read back at every change -- empty is {}, a
      // mistake leaves Save saying so
      box.appendChild(K.yaml({ value: cur, label: o.label || 'YAML', fk: o.sk + ':yaml', sk: o.sk + ':yaml',
        onChange: function (v, ok) {
          valid = ok; cur = v;
          if (valid && o.onDraft) o.onDraft(cur);
        } }));
    }

    // ---------------------------------------------------------- add a screen
    p_add(sub) {
      var self = this, d = this.data;
      // a host that can't make a screen says why instead
      var addNote = this.hostNote('add_screen');
      if (addNote) {
        return { title: 'Add Screen', back: [this.title(), '#/'], body: function (c) {
          c.appendChild(K.group({ footer: addNote }, []));
        } };
      }
      var others = d.dashboards.filter(function (x) { return !x.item; });
      this._new = this._new || { name: '', kind: 'wall_tablet', admin: false };
      var nw = this._new;
      if (sub[0] === 'kind') {
        return { title: 'Shown On', back: ['Add Screen', '#/add-screen'], body: function (c) {
          c.appendChild(K.group({ footer: 'It starts with the settings that suit it. Everything can be changed afterwards.' },
            Object.keys(M.PRESETS).map(function (k) {
              return K.check({ label: M.PRESETS[k][0], sub: M.PRESETS[k][1], on: nw.kind === k, fk: 'kind:' + k,
                               onClick: function () {
                                 nw.kind = k;
                                 // an energy display is only the Energy page; leaving it, a whole screen again
                                 if (k === 'energy') nw.shows = 'energy';
                                 else if (nw.shows === 'energy') nw.shows = 'all';
                                 self.back('#/add-screen');
                               } });
            })));
        } };
      }
      if (sub[0] === 'shows') {
        return { title: 'Shows', back: ['Add Screen', '#/add-screen'], body: function (c) { self.showsChoices(c, nw); } };
      }
      if (sub[0] === 'from') {
        nw.copy = nw.copy || { from: null, groups: M.copyDefaults() };
        var mine = d.dashboards.filter(function (x) { return x.item && d.boards[x.path]; });
        return { title: 'Copy Settings From', back: ['Add Screen', '#/add-screen'], body: function (c) {
          c.appendChild(K.group({ footer: 'The new screen starts from its Shown On preset; what you tick below is then copied from this screen.' },
            [K.check({ label: 'Nothing', sub: 'Just the preset', on: !nw.copy.from, fk: 'newfrom:none',
                       onClick: function () { nw.copy.from = null; self.render(); } })].concat(mine.map(function (x) {
              return K.check({ label: x.title, sub: '/' + x.path, on: nw.copy.from === x.path, fk: 'newfrom:' + x.path,
                               onClick: function () { nw.copy.from = x.path; self.render(); } });
            }))));
          if (nw.copy.from) self.copyGroups(c, nw.copy);
        } };
      }
      if (sub[0] === 'use' && sub[1]) {
        var x = this.dash(sub[1]);
        this._use = this._use && this._use.path === sub[1] ? this._use : { path: sub[1], kind: 'custom' };
        var use = this._use;
        return { title: x ? 'Set Up ' + x.title : 'Set Up', back: ['Add Screen', '#/add-screen'],
          scope: 'What is it shown on? It starts with the settings that suit it; every one can be changed afterwards.', body: function (c) {
            c.appendChild(K.group({ header: 'Shown On' }, Object.keys(M.PRESETS).map(function (k) {
              return K.check({ label: M.PRESETS[k][0], sub: M.PRESETS[k][1], on: use.kind === k, fk: 'usekind:' + k,
                               onClick: function () {
                                 use.kind = k;
                                 if (k === 'energy') use.shows = 'energy'; else if (use.shows === 'energy') use.shows = 'all';
                                 self.render();
                               } });
            })));
            if (x && x.generated) self.showsChoices(c, use, true);
            c.appendChild(K.group({ footer: x && x.generated ? self.showsNote(use) : null }, [K.button({ label: 'Set Up Screen', center: true, fk: 'use:go', onClick: function () {
              self.status('saving');
              self.createItem(sub[1], use.kind).then(function () { return self.applyShows(sub[1], use); }).then(function () {
                self.status('saved');
                return self.reload();
              }).then(function () {
                // from the Setup Assistant's First Screen step: on to its last step
                if (self.from[hashOf(location.hash)] === '#/setup/' + SETUP_FIRST) { self._created = sub[1]; self.go('#/setup/' + (SETUP_FIRST + 1)); return; }
                self.go('#/screens/' + encodeURIComponent(sub[1]));
              }, function (e) {
                self.status('error'); self.announce('Couldn’t set it up: ' + (e && e.message || e));
              });
            } })]));
          } };
      }
      return { title: 'Add Screen', top: true, body: function (c) { self.addScreenBody(c, others); } };
    }
    addScreenBody(c, others, after) {
      var self = this, nw = this._new = this._new || { name: '', kind: 'wall_tablet', admin: false };
      var nameRow = K.text({ label: 'Name', value: nw.name, placeholder: 'Kitchen', sk: 'new:name', maxlength: 40,
                             onCommit: function (v) { nw.name = v; } });
      c.appendChild(K.group({ header: 'New Screen', footer: 'A new dashboard that builds itself from your rooms and devices.' }, [
        nameRow,
        K.nav({ label: 'Shown On', value: M.PRESETS[nw.kind][0], href: '#/add-screen/kind', sk: 'new:kind' }),
        K.nav({ label: 'Shows', value: self.showsLabel(nw), href: '#/add-screen/shows', sk: 'new:shows' }),
        K.nav({ label: 'Copy Settings From', sk: 'new:from', href: '#/add-screen/from',
                value: nw.copy && nw.copy.from ? ((self.dash(nw.copy.from) || {}).title || nw.copy.from) : 'Nothing' }),
        K.toggle({ label: 'Only Admins Can Open It', on: nw.admin, sk: 'new:admin', onChange: function (on) { nw.admin = on; } })]));
      c.appendChild(K.group({ footer: self.showsNote(nw) }, [K.button({ label: nw.shows && nw.shows !== 'all' ? 'Create Page Screen' : 'Create Screen', center: true, fk: 'new:go', onClick: function () {
        var inp = self.shadowRoot.querySelector('[data-fk="new:name"]');
        var title = String((inp && inp.value) || nw.name || '').trim();
        if (!title) { self.errors['new:name'] = 'Give it a name.'; self.render(); return; }
        delete self.errors['new:name'];
        self.status('saving');
        var copy = nw.copy && nw.copy.from ? nw.copy : null;
        var src = copy ? self.data.boards[copy.from] : null;
        var shows = { shows: nw.shows || 'all', kind: nw.kind };
        self.createScreen(title, nw.kind, nw.admin).then(function (path) {
          // the preset first, then what was chosen from the other screen
          return copy && src ? self.setB(path, M.copyChanges(src, copy.groups)).then(function () { return path; }) : path;
        }).then(function (path) {
          // then what it shows: everything, or only some pages
          return self.applyShows(path, shows).then(function () { return path; });
        }).then(function (path) {
          self._new = null;
          self.status('saved');
          return self.reload().then(function () {
            if (after) { after(path); return; }
            // only some pages: on to picking them, with nothing picked yet
            self.go('#/screens/' + encodeURIComponent(path) + (shows.shows === 'pages' ? '/pages' : ''));
          });
        }, function (e) { self.status('error'); self.announce('Couldn’t create it: ' + (e && e.message || e)); });
      } })]));
      if (this.err('new:name')) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('new:name') }));
      if (others && others.length) {
        c.appendChild(K.group({ header: 'Existing Dashboards', footer: 'Give a dashboard you already have its own HK settings.' },
          others.map(function (x) {
            return K.nav({ label: x.title, sub: '/' + x.path, href: '#/add-screen/use/' + encodeURIComponent(x.path) });
          })));
      }
    }
    // WHAT A NEW SCREEN SHOWS: everything (Home, rooms, every page -- a
    // normal screen), or only some pages (no Home: an Energy display, a
    // Security panel). Asked when it is made, so a page screen is never made
    // by accident, and never mistaken for a whole one.
    showsLabel(nw) {
      return nw.shows === 'energy' ? 'Only the Energy Page' : nw.shows === 'pages' ? 'Only Some Pages' : 'Everything';
    }
    showsNote(nw) {
      return nw.shows === 'energy' ? 'A page screen: only the Energy page, with no Home page and no rooms.'
        : nw.shows === 'pages' ? 'A page screen: no Home page and no rooms. You pick its pages next; until you do, it shows everything.'
        : 'A whole screen: Home, your rooms and every page your home has.';
    }
    showsChoices(c, nw, inline) {
      var self = this, energyOn = this.energyOn();
      var pick = function (v) { return function () { nw.shows = v; if (inline) self.render(); else self.back('#/add-screen'); }; };
      var rows = [
        K.check({ label: 'Everything', sub: 'Home, your rooms and every page — a normal screen', on: !nw.shows || nw.shows === 'all',
                  fk: 'shows:all', onClick: pick('all') }),
        K.check({ label: 'Only Some Pages', sub: 'No Home page, no rooms: just the pages you pick next — Security and Cameras, say',
                  on: nw.shows === 'pages', fk: 'shows:pages', onClick: pick('pages') })];
      if (energyOn) {
        rows.push(K.check({ label: 'Only the Energy Page', sub: 'An energy display', on: nw.shows === 'energy', fk: 'shows:energy',
                            onClick: pick('energy') }));
      }
      c.appendChild(K.group({ header: inline ? 'Shows' : null,
        footer: 'Either way it can be changed later on its Pages page (Home Page on or off). Nothing is deleted either way.' }, rows));
    }
    applyShows(path, nw) {
      if (nw.shows === 'pages') return this.setB(path, { home_page: false, only_pages: [] });
      if (nw.shows === 'energy') return this.setB(path, { home_page: false, only_pages: ['energy'] });
      // everything: a whole screen, whatever the preset said
      return this.setB(path, { home_page: true });
    }
    // a dashboard's item, through its own flow (what it is shown on, then
    // its menu as that starts it)
    async createItem(path, kind) {
      var base = 'config/config_entries/subentries/flow';
      var r = await this.rest('POST', base, { handler: [this.data.entry_id, 'dashboard'] });
      var fid = r.flow_id;
      try {
        r = await this.rest('POST', base + '/' + fid, { dashboard: path });
        if (r.step_id === 'kind') r = await this.rest('POST', base + '/' + fid, { kind: kind });
        if (r.step_id === 'settings') r = await this.rest('POST', base + '/' + fid, {});
      } catch (e) {
        this.rest('DELETE', base + '/' + fid).catch(function () {});
        throw e;
      }
      if (r.type !== 'create_entry') throw new Error(r.reason || 'not set up');
    }
    async createScreen(title, kind, admin) {
      var slug = 'hk-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
      var taken = this.data.dashboards.map(function (d) { return d.path; });
      var path = slug, n = 2;
      while (taken.indexOf(path) >= 0) path = slug + '-' + (n++);
      await this.actions().callWS({ type: 'lovelace/dashboards/create', url_path: path, title: title,
                          icon: 'mdi:home-heart', show_in_sidebar: true, require_admin: !!admin, mode: 'storage' });
      await this.actions().callWS({ type: 'lovelace/config/save', url_path: path, config: { strategy: { type: 'custom:hk-dashboard' } } });
      await this.createItem(path, kind);
      return path;
    }

    // ---------------------------------------------------------- custom chips
    // CUSTOM CHIPS (Library): the house's own status chips in YAML
    // (settings.py SUBENTRY_CHIP), shown by the screens that list them.
    p_chips(sub) {
      var self = this, lib = this.data.custom_chips || [], base = '#/chips';
      var mk = function (t, body) { return { title: t, back: ['Custom Chips', base], body: body }; };
      var where = function (after) {
        return after === 'start' ? 'At the start' : after === 'end' || !after ? 'At the end' : 'After ' + (M.CHIP_LABELS[after] || after);
      };
      var usedOn = function (key) {
        return self.data.dashboards.filter(function (d) { var bb = self.data.boards[d.path]; return bb && (bb.chips_custom || []).indexOf(key) >= 0; })
          .map(function (d) { return d.title; });
      };
      if (!sub[0]) {
        return { title: 'Custom Chips', top: true, scope: 'Status chips you write yourself, for any screen.', body: function (c) {
          c.appendChild(K.group({ footer: 'A chip in YAML — an hk-status-chip-card, or one inside a conditional that shows it only sometimes. A screen shows it once it’s added to that screen’s Status Chips.' },
            lib.map(function (x) {
              var on = usedOn(x.key);
              return K.nav({ label: x.name, sub: where(x.after) + ' · ' + (on.length ? on.join(', ') : 'On no screen yet'),
                             href: base + '/' + encodeURIComponent(x.key), fk: 'chips:' + x.key });
            }).concat([K.nav({ label: 'Add Custom Chip', href: base + '/new', icon: 'mdi:plus-circle-outline', fk: 'chips:new' })])));
        } };
      }
      var key = decodeURIComponent(sub[0]), chip = lib.filter(function (x) { return x.key === key; })[0];
      if (key !== 'new' && !chip) return mk('Custom Chip', function (c) { c.appendChild(K.group({ footer: 'That chip isn’t there any more.' }, [])); });
      var f = (this._chipForms = this._chipForms || {})[key] = this._chipForms[key] ||
        (chip ? { name: chip.name, after: chip.after } : { name: '', after: 'end' });
      var save = function (card) {
        return self.ws(Object.assign({ type: DOMAIN + '/chip/save', name: f.name, after: f.after, card: card },
                                     chip ? { key: chip.key } : {}), ['name', 'card', 'after']);
      };
      return mk(chip ? chip.name : 'Add Custom Chip', function (c) {
        c.appendChild(K.group({}, [
          K.text({ label: 'Name', sk: 'name', value: f.name, placeholder: 'House Battery', maxlength: 40, error: self.err('name'),
                   onCommit: function (v) { f.name = v.trim(); if (chip) save(chip.card); } }),
          K.select({ label: 'Sits', sk: 'after', value: f.after,
                     options: [['start', 'At the Start']].concat(self.data.chip_kinds.map(function (k) { return [k, 'After ' + (M.CHIP_LABELS[k] || k)]; }), [['end', 'At the End']]),
                     onChange: function (v) { f.after = v; if (chip) save(chip.card); else self.render(); } })]));
        // THE DRAFT IS THE PAGE'S (f.card): a redraw -- a name or place
        // committed, a save elsewhere -- rebuilt the editor from the stored
        // card and threw away what was being written.
        self.yamlPage(c, { value: f.card !== undefined ? f.card : (chip ? chip.card : {}), sk: 'card', clear: false,
          saveLabel: chip ? 'Save Chip' : 'Add Chip', onDraft: function (v) { f.card = v; },
          help: 'The chip, as a card. Where it sits applies unless a screen orders its chips itself.',
          example: 'type: custom:hk-status-chip-card\nentity: sensor.home_battery_level\nname: House Battery\nicon: hk:home-battery\nicon_color: green\ntap_action:\n  action: navigate\n  navigation_path: ./power',
          onSave: function (card) {
            if (!f.name) { self.errors.name = M.errorText('name_needed'); self.render(); return; }
            save(card).then(function (ok) {
              if (!ok) return;
              delete self._chipForms[key];
              self.reload().then(function () { self.back(base); });
            });
          } });
        if (chip) {
          // ITS SCREENS (2026-10-13): where it shows, Always or When Active
          c.appendChild(K.group({ header: 'Screens', footer: 'Each screen that shows it: Always, or only When Active — like the other chips.' }, [
            K.nav({ label: 'On Screens', value: self.chipSays(self.chipScreens('chip:' + chip.key)), icon: 'mdi:label-multiple',
                    href: '#/house/chips/' + encodeURIComponent('chip:' + chip.key), sk: 'chips:screens:' + chip.key })]));
          var on = usedOn(chip.key);
          c.appendChild(K.group({ footer: on.length ? 'On ' + on.join(', ') + '.' : 'No screen shows it yet: add it on a screen’s Status Chips.' }, [
            K.button({ label: 'Delete Chip', destructive: true, fk: 'chips:delete', onClick: function () {
              K.confirm(self.shadowRoot, { title: 'Delete “' + chip.name + '”?', ok: 'Delete', destructive: true,
                message: on.length ? 'It goes from ' + on.join(', ') + ' too.' : 'No screen shows it.' })
                .then(function (yes) {
                  if (!yes) return;
                  self.ws({ type: DOMAIN + '/chip/remove', key: chip.key }, ['key'])
                    .then(function (ok) { if (ok) self.reload().then(function () { self.back(base); }); });
                });
            } })]));
        }
      });
    }
    // ---------------------------------------------------------- all screens
    p_music(sub) {
      var self = this, base = '#/features/music', title = 'Music';
      var mk = function (tt, body) { return { title: tt, back: [title, base], body: body }; };
      if (sub[0] === 'categories') return mk('Categories', function (c) { self.h_categories(c); });
      if (sub[0] === 'discover') return mk('Discover Rows', function (c) { self.h_discover(c); });
      // the Music feature's own pages (hk-settings-features.js)
      var fp = sub.length ? F.page(this, ['music'].concat(sub)) : null;
      if (fp) return fp;
      return { title: title, top: true, scope: 'Applies to every screen.', body: function (c) { self.h_music(c); } };
    }
    // ================================================================ PAGES
    // THE PAGES SECTION (2026-10-16, PLAN-2026-10-16-pages-settings.md):
    // each generated page's settings on one page of its own, the same groups
    // in the same order -- Header, Status Row, What's on It, the page's own,
    // Background, Its Pill on Home, Related. A page that comes from a
    // feature (Energy, Music, Live TV) opens on that feature's settings;
    // those pages' own sub-pages keep their #/features/... addresses.
    pageHas() {
      var st = (this.client && this.client.states) || {}, n = function (dom) {
        return Object.keys(st).filter(function (k) { return k.indexOf(dom + '.') === 0; }).length;
      };
      return { kinds: this.data.kinds || {}, alarm: this.hs('security.alarm'), cameras: n('camera'), calendars: n('calendar'), weather: n('weather') };
    }
    pagesListed() { return M.pagesListed(this.pageHas()); }
    // a page's line under its name in the sidebar
    pageSays(key) {
      var S = this.data.settings || {}, bits = [];
      if (M.HEADER_PAGES[key]) bits.push(((S.headers || {})[key] || {}).show === false ? 'Header Off' : 'Header On');
      var ch = ((this.data.choices || {}).status_rows || {})[key];
      if (ch) bits.push('Row: ' + M.statusSummary(Object.assign({ status: ch.default }, (S.status_rows || {})[key]).status));
      var f = M.PAGE_FEATURES[key];
      if (f && (key === 'energy' || key === 'power' || key === 'live_tv')) {
        var t = F.LIST.filter(function (x) { return x[0] === f; })[0];
        if (t && F.stateOf(this.data.features, t[1]) !== 'added') bits.push('Not Set Up');
      }
      return bits.join(' · ') || null;
    }
    p_page(key, sub) {
      var self = this, t = M.pageOf(key);
      if (!t) return this.p_overview();
      var base = '#/page/' + key, title = t[1];
      var mk = function (tt, body, back) { return { title: tt, back: back || [title, base], body: body }; };
      var s0 = sub[0];
      if (s0 === 'status' && ((this.data.choices || {}).status_rows || {})[key]) {
        return mk('Status Row', function (c) { self.h_statusRow(c, key, true); });
      }
      if (s0 === 'background') {
        var row = this.skyRow(key, null);
        return mk('Background', function (c) {
          if (row && self.flatHere(null)) self.flatPagePicker(c, null, null, row, '#/house/sky');
          else if (row) self.pagePicker(c, null, null, row);
          else c.appendChild(K.group({ footer: 'This page isn’t on any screen yet, so it has no background to choose.' }, []));
        });
      }
      if (s0 === 'pill' && M.PAGE_PILL_DEFAULTS[key]) return mk('Its Pill on Home', function (c) { self.s_pill(c, null, null, key); });
      if (s0 === 'accent') return mk('Accent Color', function (c) { self.pageAccent(c, key); });
      if (s0 === 'order' && PAGE_ORDERS[key]) return { title: 'Tile Order', back: [title, base], scope: this.orderScope(key),
                                                      body: function (c) { self.a_pageOrder(c, key); } };
      if (key === 'timers' && s0 === 'house') return mk('House Timers', function (c) { self.h_timers(c); });
      if (key === 'weather' && s0 === 'sensors') return mk('Sensors', function (c) { self.h_weatherSensors(c); });
      if (key === 'weather' && s0 === 'forecast') return mk('Forecast & Details', function (c) { self.h_weatherForecast(c); });
      if (key === 'weather' && s0 === 'radar') {
        if (sub[1] === 'advanced') return mk('Advanced', function (c) { self.h_radarAdvanced(c); }, ['Radar Map', base + '/radar']);
        if (sub[1] === 'yaml') return mk('Weather Radar Card Options', function (c) { self.h_radarLegacy(c); }, ['Radar Map', base + '/radar']);
        return mk('Radar Map', function (c) { self.h_radar(c); });
      }
      if (key === 'calendar' && s0) return mk(self.name(s0), function (c) { self.h_calendarOne(c, s0); });
      if (s0) return this.p_page(key, []);
      return { title: title, top: true, scope: PAGE_SCOPE[key] || 'This page’s settings, on every screen that shows it.',
               body: function (c) { self.h_page(c, key); } };
    }
    // a feature's own settings page, drawn here (its top page's body)
    pageFeature(c, route) {
      var fp = F.page(this, [route]);
      if (fp && fp.body) fp.body(c);
    }
    h_page(c, key) {
      var self = this, S = this.data.settings || {}, base = '#/page/' + key;
      var set = function (k) { return function (v) { var o = {}; o[k] = v; self.setH(o); }; };
      // THE PAGE'S OWN, first where the page is a feature's or one of All
      // Screens' old pages (Weather, Calendar, Cameras): what it is about
      if (key === 'energy') this.pageFeature(c, 'energy');
      if (key === 'music') this.h_music(c);
      if (key === 'live_tv') this.pageFeature(c, 'tv');
      if (key === 'weather') this.h_weather(c);
      if (key === 'calendar') this.h_calendar(c);
      if (key === 'power') {
        var pp = F.page(this, ['energy', 'power']);
        if (pp && pp.body) pp.body(c);
        c.appendChild(K.group({ footer: 'The circuits, meters and batteries the Power page draws are the Energy page’s devices.' }, [
          K.nav({ label: 'Energy’s Devices', icon: 'mdi:lightning-bolt', href: '#/features/energy/devices', fk: 'page:power:devices' })]));
      }
      // 1. HEADER
      if (M.HEADER_PAGES[key]) {
        this.h_header(c, key);
        var off = M.headerOffOn(this.data.boards, key);
        if (off.length) {
          c.appendChild(K.group({ footer: 'Each screen’s own Page Headers can turn this header off there.' }, off.map(function (p) {
            var d = self.dash(p);
            return K.nav({ label: d ? d.title : p, value: 'Off on This Screen', icon: 'mdi:monitor-dashboard',
                           href: '#/screens/' + encodeURIComponent(p) + '/page-headers', fk: 'page:hdoff:' + p });
          })));
        }
      }
      // 2. STATUS ROW
      var ch = ((this.data.choices || {}).status_rows || {})[key];
      if (ch) {
        var cur = Object.assign({ status: ch.default }, (S.status_rows || {})[key]);
        c.appendChild(K.group({ header: 'Status Row', footer: 'Under the page’s name: what it shows, in order, and the rooms it leaves out.' }, [
          K.nav({ label: 'Status Row', value: M.statusSummary(cur.status), href: base + '/status', sk: 'status_rows.' + key })]));
      }
      // 3. THE PAGE'S OWN SETTINGS
      if (key === 'security') {
        var sugg = !this.hs('security.alarm') && (this.data.suggest || {}).alarm;
        c.appendChild(K.group({ header: 'Security System', footer: 'The header’s security line, the Security chip and page, and the alarm keypad.' }, [
          this.entityRow({ label: 'Alarm Panel', sk: 'security.alarm', value: this.hs('security.alarm'), none: 'No Alarm',
                           filter: { domains: ['alarm_control_panel'] }, onPick: set('security.alarm') }),
          sugg ? K.button({ label: 'Use ' + this.name(sugg), fk: 'alarm:suggest', onClick: function () { set('security.alarm')(sugg); } }) : null]));
        this.pageFeature(c, 'alarm');
        c.appendChild(K.group({ header: 'Alarm Keypad', footer: 'Empty for most alarms: a refused code shows “Wrong Code” by itself. Only for a panel that fails silently.' }, [
          this.entityRow({ label: 'Wrong-Code Indicator', sk: 'features.alarm_bad_code', value: this.hs('features.alarm_bad_code'), none: 'Automatic',
                           filter: { domains: ['input_boolean', 'binary_sensor'] }, onPick: set('features.alarm_bad_code') })]));
      }
      if (key === 'timers') {
        var ht = this.hs('features.house_timers') || [];
        c.appendChild(K.group({ header: 'House Timers', footer: 'One-tap timers on the Timers page — a nap, bedtime. Their names and icons are Home Assistant’s.' }, [
          K.nav({ label: 'House Timers', value: ht.length ? String(ht.length) : 'None', href: base + '/house', sk: 'features.house_timers' })]));
      }
      if (key === 'vacuums') {
        this.pageFeature(c, 'clean');
        c.appendChild(K.group({ header: 'Your Own Script', footer: 'Empty: cleaning by area goes through Clean Areas. Only for a house whose own script receives the areas.' }, [
          this.entityRow({ label: 'Clean-Areas Script', sk: 'features.vacuum_script', value: this.hs('features.vacuum_script'), none: 'Clean Areas',
                           filter: { domains: ['script'] }, onPick: set('features.vacuum_script') })]));
      }
      if (key === 'cameras') this.h_cameras(c, true);
      // 4. WHAT'S ON IT: the accessory types, each its own page under
      // Accessories, and the page's tile order where it has one
      var types = (M.PAGE_TYPES[key] || []).map(function (k) { return M.accType(k); }).filter(Boolean);
      if (types.length) {
        var rows = types.map(function (T) {
          return K.nav({ label: T[1], icon: T[2], value: String(self.typeCount(T)), href: '#/accessories/type/' + T[0], fk: 'page:type:' + T[0] });
        });
        if (PAGE_ORDERS[key]) {
          var po = ((this.data.accessories || {}).pages || {})[key] || [];
          rows.push(K.nav({ label: 'Tile Order', value: po.length ? 'Custom' : 'Automatic', href: base + '/order', sk: 'accessories.pages.' + key }));
        }
        rows.push(K.nav({ label: 'Hidden Accessories', icon: 'mdi:eye-off', href: '#/accessories/hidden', fk: 'page:hidden' }));
        c.appendChild(K.group({ header: 'What’s on It', footer: 'Names, icons, rooms and what counts are each accessory’s own, the same on every page.' }, rows));
      }
      // 5. BACKGROUND and 6. ITS PILL ON HOME
      var look = [], row = this.skyRow(key, null), bds = (this.data.choices || {}).sky_backdrops || [];
      if (row && key !== 'cameras') {          // (Cameras' is in its Related)
        look.push(K.nav({ label: 'Background', value: this.skyPageLabel(row, null),
                          href: base + '/background', sk: (this.flatHere(null) ? 'sky.flat_pages:' : 'sky.pages:') + key }));
      }
      if (M.PAGE_PILL_DEFAULTS[key]) {
        var own = (this.hs('look.page_pills') || {})[key] || {};
        look.push(K.nav({ label: 'Its Pill on Home', value: Object.keys(own).length ? 'Customized' : 'Default', href: base + '/pill', sk: 'look.page_pills:' + key }));
      }
      // 7. ITS ACCENT COLOR (2026-10-17): the menu's color for it while a
      // screen's Highlight Color is Automatic, and in Flat its Automatic
      // background's shade
      var pa = M.pageAccentOf(key, this.hs('look.page_accents'));
      look.push(K.nav({ label: 'Accent Color', value: pa.own ? pa.a.name : 'Default (' + pa.d.name + ')', href: base + '/accent',
                        tile: ['', pa.a.hex], sk: 'look.page_accents:' + key }));
      // 8. FLAT COLORS (2026-10-17): Flat's own palette for this page, over
      // the screens' general colors -- where any screen uses Flat
      var lookFoot = 'Its background on every screen that doesn’t choose its own, the pill in a screen’s Scenes row that opens it, and its Accent Color: the page’s identity in every look — its color in the menu while a screen’s Highlight Color is Automatic, and in Flat the shade of its Automatic background.';
      if (row && this.flatAnywhere()) {
        look.push(this.flatColorsNav(this.flatScope('house-page', null, null, key), { tile: false, inherited: 'Same as All Screens' }));
        lookFoot += ' Flat Colors: Flat’s own Accent Color and Off Pill Tint for this page; Automatic uses the Accent Color above.';
      }
      if (look.length) c.appendChild(K.group({ header: 'Look', footer: lookFoot }, look));
      // 7. ON SCREENS: every generated screen, whether it shows the page --
      // each a way to that screen's Pages on This Screen, the page's row lit
      var dash = this.data.dashboards.filter(function (d) { return d.item && d.generated; }), bd = this.data.boards || {};
      var offHd = M.headerOffOn(bd, key);
      var scr = dash.map(function (d) {
        var b = bd[d.path] || {}, shows = M.screenShows(b, key);
        var a = K.nav({ label: d.title, icon: 'mdi:monitor-dashboard',
                        sub: shows && offHd.indexOf(d.path) >= 0 ? 'Header off on this screen' : null,
                        value: shows ? 'Shown' : 'Not Shown', href: '#/screens/' + encodeURIComponent(d.path) + '/pages', fk: 'page:screen:' + d.path });
        // its row on that page, lit when it opens (render's _flash)
        a.addEventListener('click', function () { self._flash = ['pages:grip:' + key, 'place:' + key, 'opages:grip:' + key, 'pages:' + key]; });
        return a;
      });
      if (scr.length) {
        c.appendChild(K.group({ header: 'On Screens', footer: 'Which pages a screen shows, and where each sits in its menu, is that screen’s own: tap one to change it there.' }, scr));
      }
      var rel = [];
      if (key === 'music') rel.push(K.nav({ label: 'Now Playing', sub: 'The bar or side pane on every page', icon: 'mdi:music', href: '#/house/nowplaying', fk: 'page:rel:np' }));
      if (key === 'climate' || key === 'energy') {
        var chip = key === 'climate' ? 'climate' : 'energy';
        rel.push(K.nav({ label: (M.CHIP_LABELS[chip] || chip) + ' Chip', sub: this.chipSays(this.chipScreens(chip)), icon: 'mdi:label-multiple',
                         href: '#/house/chips/' + chip, fk: 'page:rel:chip' }));
      }
      if (key === 'weather') rel.push(K.nav({ label: 'Screensaver', sub: 'Its forecast and weather screen read these too', icon: 'mdi:image-multiple', href: '#/house/screensaver', fk: 'page:rel:saver' }));
      if (rel.length) c.appendChild(K.group({ header: key === 'cameras' ? 'Also' : 'Related' }, rel));
    }
    p_house(page, sub) {
      // WHAT COUNTS (2026-10-13) is each type's page under Accessories now: its
      // old addresses (#/house/counts/<kind>) open the type
      if (page === 'counts') return this.p_accessories(sub[0] && M.accType(sub[0]) ? ['type', sub[0]] : []);
      var self = this, t = HOUSE.filter(function (p) { return p[0] === page; })[0];
      if (!t) return this.p_overview();
      var base = '#/house/' + page, title = t[1];
      var scope = 'Applies to every screen.';
      var mk = function (tt, body, back) { return { title: tt, back: back || [title, base], body: body }; };
      // STATUS CHIPS (2026-10-13): every screen's chip row, and each chip
      // across the screens -- Always or When Active, set right there
      if (page === 'chips') {
        if (sub[0]) {
          var ck = decodeURIComponent(sub[0]), cc = ck.indexOf('chip:') === 0 ? this.customChip(ck.slice(5)) : null;
          return mk((cc ? cc.name : M.CHIP_LABELS[ck] || ck) + ' Chip', function (c) { self.h_chipOne(c, ck); });
        }
        return { title: title, top: true, scope: 'Which chips each screen shows is its own. Here they are side by side, and each chip on every screen.',
                 body: function (c) { self.h_chips(c); } };
      }
      if (page === 'nowplaying') {
        return { title: title, top: true, scope: 'Applies to every screen that doesn’t choose its own.', body: function (c) { self.h_nowPlaying(c); } };
      }
      if (page === 'appearance') {
        if (sub[0] === 'glass') return mk('Appearance Style', function (c) { self.h_glass(c); });
        if (sub[0] === 'flat-colors') return this.p_flatColors('house', null, null, sub.slice(1), mk, [title, base]);
        if (sub[0] === 'pills') return mk('Page Pills', function (c) { self.h_pills(c); });
        if (sub[0] === 'pill' && sub[1]) {
          return mk(M.PAGE_LABELS[sub[1]] || sub[1], function (c) { self.s_pill(c, null, null, sub[1]); }, ['Page Pills', base + '/pills']);
        }
        return { title: title, top: true, scope: 'Applies to every screen that doesn’t choose its own.', body: function (c) { self.h_appearance(c); } };
      }
      if (page === 'sky') {
        if (sub[0] === 'advanced') return mk('Advanced', function (c) { self.h_skyAdvanced(c); });
        if (sub[0] === 'backdrop') return mk('Sky Colors', function (c) { self.h_backdrop(c); });
        if (sub[0] === 'landscape') return mk('Choose a Landscape', function (c) {
          self.landscapePick(c, { value: self.data.settings.sky.landscape || 'every:1440', fk: 'hlandpick',
                                  onSet: function (v) { self.setH({ 'sky.landscape': v }); } });
        });
        if (sub[0] === 'pages') return mk('Sky / Background', function (c) { self.h_sky(c); });
        if (sub[0] === 'lively') return mk('Each Occasion', function (c) { self.livelyList(c, null); });
        // FLAT'S OWN: its page while All Screens wears another look, and its
        // pages' -- and a page's while All Screens wears Flat
        var fbase = sub[0] === 'flat' ? base + '/flat' : base;
        var fsub = sub[0] === 'flat' ? sub.slice(1) : sub;
        if ((sub[0] === 'flat' || this.flatHere(null)) && fsub[0] === 'page' && fsub[1]) {
          var fkey = decodeURIComponent(fsub[1]), frow = this.skyRow(fkey, null);
          return mk(frow ? frow.label : 'Page', function (c) { if (frow) self.flatPagePicker(c, null, null, frow, fbase); },
                    frow && frow.room ? ['Room Pages', fbase + '/page/rooms'] : [sub[0] === 'flat' ? 'Flat Backgrounds' : 'Sky / Background', fbase]);
        }
        if (sub[0] === 'flat') return mk('Flat Backgrounds', function (c) { self.flatSky(c, null, null, fbase); }, ['Sky / Background', base]);
        if (sub[0] === 'page' && sub[1]) {
          var hkey = decodeURIComponent(sub[1]);
          var hrow = this.skyRow(hkey, null);
          return mk(hrow ? hrow.label : 'Page', function (c) { if (hrow) self.pagePicker(c, null, null, hrow); },
                    hrow && hrow.room ? ['Room Pages', base + '/page/rooms'] : ['Sky / Background', base]);
        }
        if (sub[0] === 'woodland' && sub[1]) {
          var ws = M.WOODLAND.filter(function (w) { return w[0] === sub[1]; })[0];
          if (ws) return mk(ws[1], function (c) { self.h_season(c, ws); }, ['Woodland Between Occasions', base + '/woodland']);
        }
        if (sub[0] === 'woodland') return mk('Woodland Between Occasions', function (c) { self.h_woodland(c); });
        if (sub[0] === 'night') return mk('Night Sky', function (c) { self.h_nightSky(c); });
        // THE SKY'S PREVIEW: today's sky on the Sky page, a theme's on its
        // own page (skyPreview), on the house's Home screen
        var spv = M.skyPreviewScreen(this.data.dashboards, this.data.boards);
        var withSky = function (pg, theme) { if (spv) { pg.preview = spv; pg.sky = { theme: theme }; } return pg; };
        var th = M.SKY_THEMES.filter(function (x) { return x.id === sub[0]; })[0];
        if (th) return withSky(mk(th.label, function (c) { self.h_theme(c, th); }), th.id);
        return withSky({ title: title, top: true, scope: scope, body: function (c) { self.h_sky(c); } }, null);
      }
      if (page === 'menu') {
        var hmv = M.houseMenuAsBoard(this.data.settings.menu);
        var pickH = function (k, to) {
          return function (v) { var ch = {}; ch[k] = v; self.setH(M.houseMenuSave(ch)); self.back(to || base); };
        };
        var setHM = function (ch) { return self.setH(M.houseMenuSave(ch)); };
        var tbH = ['Tablets & Computers', base + '/tablets'], pbH = ['Phones', base + '/phones'];
        if (sub[0] === 'tablets' && sub[1] === 'style') {
          return mk('Button Style', function (c) { self.menuStyle(c, hmv.menu, pickH('menu', tbH[1]), hmv.swipe); }, tbH);
        }
        if (sub[0] === 'phones' && sub[1] === 'style') {
          return mk('Button Style', function (c) { self.phoneStyle(c, M.phoneButton(hmv), pickH('button_phone', pbH[1]), hmv.swipe); }, pbH);
        }
        if (sub[0] === 'tablets') return mk('Tablets & Computers', function (c) { self.menuTablets(c, hmv, setHM, { house: true, base: tbH[1] }); });
        if (sub[0] === 'phones') return mk('Phones', function (c) { self.menuPhones(c, hmv, setHM, { house: true, base: pbH[1] }); });
        if (sub[0] === 'accent') return mk('Highlight Color', function (c) { self.menuAccent(c, hmv.accent, pickH('accent'), self.flatHere(null) ? self.flatScope('house') : null); });
        return { title: title, top: true, scope: scope, body: function (c) { self.h_menu(c); } };
      }
      if (page === 'rooms') {
        if (sub[0] === 'order') return mk('Room Order', function (c) { self.h_roomOrder(c); });
        // THE ROOM PAGES' STATUS ROW (Status Rows' until 2026-10-16)
        if (sub[0] === 'status') return mk('Room Status Row', function (c) { self.h_statusRow(c, 'rooms'); });
        var areasH = (this.client && this.client.areas) || {};
        if (sub[0] && areasH[sub[0]]) {
          var aid = sub[0], rn = this.areaName(aid), rb = [rn, base + '/' + encodeURIComponent(aid)];
          if (sub[1] === 'order') return { title: 'Tile Order', back: rb, body: function (c) { self.a_roomOrder(c, aid); } };
          if (sub[1] === 'scenes') return { title: 'Scenes', back: rb, body: function (c) { self.a_roomScenes(c, aid); } };
          var rp = mk(rn, function (c) { self.h_room(c, aid); });
          // opened from a screen's own room list too: say whose these are
          rp.scope = 'This room’s own settings, the same on every screen.';
          return rp;
        }
        return { title: title, top: true, scope: 'Applies to every screen whose Rooms are Same as All Screens; each room’s own settings, to every screen.',
                 body: function (c) { self.h_rooms(c); } };
      }
      // SCREENSAVER (its own entry since 2026-10-13): every screen whose Same
      // as All Screens is on
      if (page === 'screensaver') {
        var bd = this.data.boards || {};
        // the preview: a screen that follows these, else any screen with the
        // screensaver, shown with these settings (1.8.0: every screen with
        // its own settings left the page with no preview at all)
        var withSaver = Object.keys(bd).filter(function (p) { return bd[p].screensaver && bd[p].screensaver_engine !== 'wallpanel'; });
        var pv = withSaver.filter(function (p) { return M.saverFollows(bd[p]); })[0] || withSaver[0];
        if (sub[0] === 'clock-style') {
          var hcur = M.saverOptions(this.hs('look.saver'));
          var hpg = mk('Clock Style', function (c) { self.saverStyle(c, hcur, self.saverPutH()); });
          if (pv) { hpg.preview = pv; hpg.saverPreview = true; hpg.saverHouse = true; }
          return hpg;
        }
        if (sub[0] === 'weather') {
          var wcur = M.saverOptions(this.hs('look.saver'));
          var hwpg = mk('Weather', function (c) { self.saverWeather(c, wcur, self.saverPutH()); });
          if (pv) { hwpg.preview = pv; hwpg.saverPreview = true; hwpg.saverHouse = true; }
          hwpg.saverWeather = true;
          return hwpg;
        }
        if (sub[0] === 'energy') {
          var ecur = M.saverOptions(this.hs('look.saver'));
          var hepg = mk('Home Energy', function (c) { self.saverEnergy(c, ecur, self.saverPutH()); });
          if (pv) { hepg.preview = pv; hepg.saverPreview = true; hepg.saverHouse = true; }
          hepg.saverEnergy = true;
          return hepg;
        }
        var spg = { title: title, top: true, body: function (c) { self.h_saver(c); },
                    scope: 'What every screen’s screensaver shows, unless it has its own. When a tablet goes dark is its own Sleep Screen’s (Wall Tablets).' };
        if (pv) { spg.preview = pv; spg.saverPreview = true; spg.saverHouse = true; }
        return spg;
      }
      // WALL TABLETS (1.14): the tablets themselves, each its own page
      if (page === 'tablets') {
        if (sub[0] === 'screensaver') {
          // its old address (before 2026-10-13): forwarded to its own entry
          try { history.replaceState(null, '', '#/house/screensaver' + (sub[1] ? '/' + sub.slice(1).join('/') : '')); } catch (e) { /* no history */ }
          return this.p_house('screensaver', sub.slice(1));
        }
        var all = this.tabs();
        if (sub[0] === 'add') return mk('Add Tablet', function (c) { self.t_add(c); });
        if (sub[0] && all[sub[0]]) {
          var tid = sub[0], tt = all[tid], tb = [tt.name, base + '/' + encodeURIComponent(tid)];
          var tx = { tablet: tid, path: tt.screen, title: tt.name };
          if (sub[1] === 'sleep' && sub[2] && SLEEP_LISTS[sub[2]]) {
            return { title: SLEEP_LISTS[sub[2]].title, back: ['Sleep Screen', tb[1] + '/sleep'], body: function (c) { self.s_sleep_list_t(c, tx, tid, sub[2]); } };
          }
          if (sub[1] === 'sleep') return { title: 'Sleep Screen', back: tb, body: function (c) { self.s_sleep(c, tx, self.tabs()[tid]); } };
          if (sub[1] === 'copy') return { title: 'Copy Sleep Screen', back: tb, body: function (c) { self.t_copySleep(c, tid); } };
          return { title: tt.name, back: [title, base], body: function (c) { self.t_one(c, tid); } };
        }
        return { title: title, top: true, body: function (c) { self.h_tablets(c); },
                 scope: 'The tablets on your walls: how each one is doing, and what it does when nobody’s using it. What the screensaver shows is in Screensaver.' };
      }
      return this.p_overview();
    }
    h_timers(c) {
      var self = this, cur = this.hs('features.house_timers') || [];
      var set = function (v) { self.setH({ 'features.house_timers': v }); };
      c.appendChild(K.listEditor({ fk: 'timers', shownHeader: 'House Timers', emptyText: 'None', announce: this.announce.bind(this),
        rows: cur.map(function (id) { return { value: id, label: self.name(id) }; }),
        onChange: set, addLabel: 'Add Timer…', onAddOther: function () {
          self.go(self.picker('timer-add', { title: 'Add Timer', value: null, multi: true,
            items: function () { return self.entityIds({ domains: ['timer'] }).filter(function (id) { return cur.indexOf(id) < 0; })
              .map(function (id) { return { value: id, label: self.name(id), sub: id }; }); },
            onPick: function (id) { if (id) set(cur.concat(id)); } }));
        } }));
    }
    // A STATUS ROW: a room page's (Rooms), or a page's (Pages -> the page)
    // -- what it shows, in its order, and the rooms a page's leaves out
    h_statusRow(c, page) {
      // (a page's header is on its own page, Pages -> the page, since 2026-10-16)
      var self = this, S = this.data.settings, ch = this.data.choices || {};
      var rooms = page === 'rooms';
      var spec = rooms ? { kinds: ch.status_kinds || [], default: ch.status_kinds || [] } : (ch.status_rows || {})[page];
      if (!spec) return;
      var cur = rooms ? { status: (S.rooms || {}).status || [], exclude_areas: [] }
                      : Object.assign({ status: spec.default, exclude_areas: [] }, (S.status_rows || {})[page]);
      var save = function (status, areas) {
        if (rooms) { self.setH({ 'rooms.status': status }); return; }
        var o = {}; o['status_rows.' + page] = { status: status, exclude_areas: areas };
        self.setH(o);
      };
      var item = function (k) { return { value: k, label: M.STATUS_LABELS[k] || k, sub: M.STATUS_SAYS[k] }; };
      c.appendChild(K.listEditor({ fk: 'st', shownHeader: 'Shown', moreHeader: 'More', announce: this.announce.bind(this),
        shownFooter: 'In this order, each when there’s something to say. Drag to change the order; remove one to hide it.' +
          (rooms ? ' A room’s temperature and humidity are its area’s own sensors (Settings → Areas → Related sensors); ' +
                   'its lights, outlets, fans and the other accessories are the tiles on its page.' : ''),
        emptyText: rooms ? 'Nothing — room pages have no status row' : 'Nothing — the page has no status row',
        rows: cur.status.map(item),
        more: spec.kinds.filter(function (k) { return cur.status.indexOf(k) < 0; }).map(item),
        onChange: function (v) { save(v, cur.exclude_areas); } }));
      if (JSON.stringify(cur.status) !== JSON.stringify(spec.default)) {
        c.appendChild(K.group({}, [K.button({ label: 'Reset to Default Order', fk: 'st:reset',
          onClick: function () { save(spec.default.slice(), cur.exclude_areas); } })]));
      }
      if (rooms) return;
      // SOURCES: what each item shown counts -- Status & Chips' kinds, less
      // the rooms left out below (the server's count knows nothing of those)
      var seen = {}, sources = [];
      cur.status.forEach(function (k) {
        var src = M.STATUS_SOURCE[k];
        if (k === 'security') {
          var alarm = (S.security || {}).alarm;
          sources.push(K.nav({ label: 'Security System', value: alarm ? self.name(alarm) : 'Automatic',
                               href: '#/page/security', sk: 'security.alarm' }));
          return;
        }
        if (!src || seen[src]) return;
        seen[src] = true;
        var ck = (self.data.counts || {})[src] || { found: [] };
        var n = ck.found.filter(function (id) { return cur.exclude_areas.indexOf(self.areaOf(id)) < 0; }).length;
        var name = (M.COUNT_KINDS.filter(function (x) { return x[0] === src; })[0] || [0, src])[1];
        sources.push(K.nav({ label: name, value: n + ' Included', href: '#/accessories/type/' + src, sk: 'counts.' + src }));
      });
      if (sources.length) c.appendChild(K.group({ header: 'Sources', footer: page === 'climate'
          ? 'Related sensors are chosen in Home Assistant’s area settings. Temperature and humidity use current readings; unavailable readings do not affect the range.'
          : 'What HK finds, less the rooms left out below. Change what counts on each accessory: Hidden Accessories and its Also Count As.' }, sources));
      c.appendChild(K.group({ header: 'Rooms', footer: 'Leave a room out of this row and its lists — an outdoor area, a shed — without hiding it anywhere else.' },
        this.areasAZ().map(function (aid) {
          var included = cur.exclude_areas.indexOf(aid) < 0;
          return K.check({ label: self.areaName(aid), multi: true, on: included, fk: 'st-area:' + aid,
            onClick: function () {
              save(cur.status, included ? cur.exclude_areas.concat(aid) : cur.exclude_areas.filter(function (a) { return a !== aid; }));
            } });
        })));
    }
    // THE PAGE'S HEADER (settings.headers.<page>, hk-headers.js): the cards
    // between the status row and the accessories. Each works itself out from
    // the house; these are only the guesses that can be wrong, each saying
    // what Automatic is.
    h_header(c, page) {
      var self = this, S = this.data.settings || {};
      var D = M.HEADER_PAGES[page].defaults;
      var cur = Object.assign({}, D, (S.headers || {})[page] || {});
      var save = function (k, v) {
        var o = {}, next = Object.assign({}, cur);
        next[k] = v;
        o['headers.' + page] = next;
        self.setH(o);
      };
      var listRow = function (k, label, sub, items, title, auto) {
        var v = cur[k];
        var href = self.picker('hd:' + page + ':' + k, { title: title, value: null, multi: true, verb: 'Use',
          items: items, onPick: function (ids) { if (ids && ids.length) save(k, [].concat(ids)); } });
        var rows = [K.nav({ label: label, sub: sub, value: Array.isArray(v) ? (v.length === 1 ? self.name(v[0]) || self.areaName(v[0]) : v.length + ' Chosen') : auto,
                            href: href, sk: 'headers.' + page, fk: 'hd:' + k })];
        if (Array.isArray(v)) rows.push(K.button({ label: 'Back to Automatic', fk: 'hd:' + k + ':auto', onClick: function () { save(k, null); } }));
        return rows;
      };
      var ents = function (domains, filt) {
        return function () {
          return self.entityIds({ domains: domains, shown: true }).filter(filt || function () { return true; })
            .map(function (id) { return { value: id, label: self.name(id), sub: id }; });
        };
      };
      var head = M.HEADER_PAGES[page];
      c.appendChild(K.group({ header: 'Header', footer: head.footer }, [
        K.toggle({ label: 'Show Header', sub: head.what, on: cur.show !== false, sk: 'headers.' + page, fk: 'hd:show',
                   onChange: function (on) { save('show', on); } })]));
      // THE LIGHTS PAGE'S BACKDROP follows the light outside: Adaptive
      // Lighting's color temperature when the house has it, else the sun's
      if (page === 'lights') {
        var al = this.entityIds({ domains: ['switch'] }).filter(function (id) {
          var a = (self.client.states[id] || {}).attributes || {};
          return /adaptive_lighting/.test(id) && a.color_temp_kelvin != null;
        });
        c.appendChild(K.group({ header: 'Background', footer: al.length
            ? 'The page’s amber takes the color of the light outside, warm at dusk and cooler at midday — from Adaptive Lighting. Automatic reads ' + (self.name(al.slice().sort(function (a, b) { return /default/.test(b) - /default/.test(a) || (a < b ? -1 : 1); })[0]) || 'the first one') + '.'
            : 'The page’s amber takes the color of the light outside, warm at dusk and cooler at midday — worked out from the sun. With Adaptive Lighting installed it follows that instead.' },
          [K.toggle({ label: 'Follow the Sun', on: cur.sky_follow !== false, sk: 'headers.lights', fk: 'hd:sky_follow', onChange: function (on) { save('sky_follow', on); } })]
            .concat(al.length && cur.sky_follow !== false ? listRow('sky_source', 'Adaptive Lighting', null, ents(['switch'], function (id) { return al.indexOf(id) >= 0; }), 'Adaptive Lighting', 'Automatic') : [])));
      }
      if (cur.show === false) return;
      if (page === 'climate') {
        c.appendChild(K.group({ footer: 'Automatic counts every thermostat on the page that reports when it heats and cools (up to three).' },
          listRow('thermostats', 'Thermostats Counted', 'Heating & Cooling Today', ents(['climate']), 'Thermostats Counted', 'Automatic')));
      } else if (page === 'lights') {
        c.appendChild(K.group({ header: 'Lighting Through the Day' }, [
          K.seg({ label: 'Rooms Shown', options: [[2, '2'], [3, '3'], [4, '4'], [5, '5']], value: cur.rooms || 3, sk: 'headers.lights', fk: 'hd:rooms',
                  onChange: function (v) { save('rooms', Number(v)); } })]));
        c.appendChild(K.group({ header: 'Left On', footer: 'A light on in a room whose motion, occupancy or presence sensors have all said nobody for this long. ' +
            'A room without such a sensor is never named. Automatic leaves out the rooms this row leaves out, and outdoor ones — a yard, a deck, the garage.' },
          [K.toggle({ label: 'Show Left On', on: cur.left_on !== false, sk: 'headers.lights', fk: 'hd:left_on', onChange: function (on) { save('left_on', on); } }),
           K.select({ label: 'Empty For', options: [[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours']],
                      value: cur.after_min || 10, sk: 'headers.lights', fk: 'hd:after', onChange: function (v) { save('after_min', Number(v)); } })]
            .concat(listRow('exclude_areas', 'Rooms Left Out', null, function () {
              return self.areasAZ().map(function (a) { return { value: a, label: self.areaName(a) }; });
            }, 'Rooms Left Out', 'Automatic'))));
        c.appendChild(K.group({ header: 'Tonight', footer: 'What your automations will do to this page’s lights in the next 16 hours, from their sun and time triggers. ' +
            'One whose conditions don’t hold right now is shown dimmed.' },
          [K.toggle({ label: 'Show Tonight', on: cur.tonight !== false, sk: 'headers.lights', fk: 'hd:tonight', onChange: function (on) { save('tonight', on); } })]
            .concat(listRow('automations', 'Automations', null, ents(['automation']), 'Automations', 'Automatic'))));
      } else if (page === 'security') {
        var way = function (k, label) {
          return listRow(k, label, null, ents(['lock', 'binary_sensor', 'cover'], function (id) {
            var dc = (self.client.states[id].attributes || {}).device_class;
            return id.indexOf('binary_sensor.') !== 0 || /^(door|garage_door|opening)$/.test(dc || '');
          }), label, 'Automatic');
        };
        c.appendChild(K.group({ header: 'Your Home', footer: 'Each label on the house reads its lock and door together. ' +
            'Automatic finds them by name — a lock or door whose name says Front, Back or Garage.' },
          [K.toggle({ label: 'Show Labels', on: cur.callouts !== false, sk: 'headers.security', fk: 'hd:callouts', onChange: function (on) { save('callouts', on); } })]
            .concat(way('front_door', 'Front Door'), way('back_door', 'Back Door'), way('garage', 'Garage'))));
        c.appendChild(K.group({ header: 'Device Care', footer: 'Shown only while a lock, door, window or leak sensor needs looking after: a low battery, or one gone quiet.' },
          [K.select({ label: 'Low Battery', options: [[10, '10%'], [15, '15%'], [20, '20%'], [25, '25%'], [30, '30%'], [40, '40%']],
                     value: cur.low_battery || 20, sk: 'headers.security', fk: 'hd:battery', onChange: function (v) { save('low_battery', Number(v)); } })]));
      } else if (page === 'water') {
        // AUTOMATIC SPELLED OUT: what the header reads when nothing is chosen
        var valves = ((this.data.counts || {}).valves || {}).found || [];
        var vn = function (id) { return self.name(id) + ' ' + id; };
        var autoSupply = valves.filter(function (id) { return /main|supply|shut.?off/i.test(vn(id)); })[0] ||
          (valves.length === 1 && !/sprinkl|irrigat|garden|drip|hose|lawn|zone|pool/i.test(vn(valves[0])) ? valves[0] : null);
        c.appendChild(K.group({ header: 'Water Through the Day', footer: 'Automatic reads the water meter in Home Assistant’s Energy settings (Settings → Dashboards → Energy → Water). ' +
            'With none there, the card stays off.' }, [
          this.entityRow({ label: 'Water Meter', sk: 'headers.water', value: cur.meter, none: 'Automatic',
                           filter: { domains: ['sensor'] }, onPick: function (v) { save('meter', v || null); } })]));
        c.appendChild(K.group({ header: 'Main Supply', footer: 'The valve the header opens and closes, after asking. Automatic: ' +
            (autoSupply ? self.name(autoSupply) : 'a valve named main, supply or shut-off — none found') + '. A sprinkler or garden valve is never the supply.' }, [
          this.entityRow({ label: 'Main Supply Valve', sk: 'headers.water', value: cur.supply, none: 'Automatic',
                           filter: { domains: ['valve', 'switch'] }, onPick: function (v) { save('supply', v || null); } })]));
      } else if (page === 'timers') {
        var STEPS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 45, 60, 90, 120, 180, 240];
        var mins = function (m) { return m < 60 ? m + ' min' : m % 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : (m / 60) + (m === 60 ? ' hour' : ' hours'); };
        var pr = (cur.presets || []).slice();
        c.appendChild(K.listEditor({ fk: 'hd:presets', shownHeader: 'Quick Durations', moreHeader: pr.length < 6 ? 'More' : null, minRows: 1,
          announce: this.announce.bind(this),
          shownFooter: 'The buttons that start a timer in one tap, in this order. Up to six; the Timers page’s Quick Start needs the quick_timers.yaml package in Home Assistant.',
          rows: pr.map(function (m) { return { value: m, label: mins(m) }; }),
          more: pr.length < 6 ? STEPS.filter(function (m) { return pr.indexOf(m) < 0; }).map(function (m) { return { value: m, label: mins(m) }; }) : [],
          onChange: function (v) { if (v.length) save('presets', v.map(Number).slice(0, 6)); } }));
        var nm = (cur.names || []).slice();
        var SUGGEST = ['Pasta', 'Oven', 'Laundry', 'Tea', 'Kids', 'Break', 'Eggs', 'Nap', 'Dryer', 'Bath', 'Homework', 'Pizza', 'Rice', 'Coffee'];
        c.appendChild(K.listEditor({ fk: 'hd:names', shownHeader: 'Quick Names', moreHeader: nm.length < 6 ? 'More' : null,
          announce: this.announce.bind(this), emptyText: 'None — a new timer is just its time',
          shownFooter: 'Create a Timer offers these as names, in this order. Up to six.',
          rows: nm.map(function (n) { return { value: n, label: n }; }),
          more: nm.length < 6 ? SUGGEST.filter(function (n) { return nm.indexOf(n) < 0; }).map(function (n) { return { value: n, label: n }; }) : [],
          onChange: function (v) { save('names', v.slice(0, 6)); } }));
        if (nm.length < 6) {
          c.appendChild(K.group({ footer: 'A name of your own, up to 16 letters.' }, [
            K.text({ label: 'Add a Name', value: '', placeholder: 'Popcorn', maxlength: 16, sk: 'headers.timers', fk: 'hd:name:add',
                     onCommit: function (v) { v = String(v || '').trim(); if (v && nm.indexOf(v) < 0) save('names', nm.concat(v).slice(0, 6)); } })]));
        }
      } else if (page === 'vacuums') {
        c.appendChild(K.group({ header: 'How Runs End', footer: 'A run is Done when a vacuum’s successful-missions counter goes up, Failed or Canceled by its others. ' +
            'Automatic finds each vacuum’s own (a Roomba’s); without them a run ends when it docks.' },
          listRow('counters', 'Mission Counters', null, ents(['sensor'], function (id) { return /mission|clean/i.test(id); }), 'Mission Counters', 'Automatic')));
      }
    }
    // ADD…, right on the kind's page (2026-10-13): the same Also Count As as
    // on each accessory, for several at once -- and the way in for a group
    // helper ("Motion - Kitchen"), which is never counted by itself (its
    // members would count twice). Offered: what the kind's Also count takes
    // (for a reading, the sensors and thermostats that report it), not
    // already counted; the server adds only what it could be (hiding._also).
    countAdd(kind, ck) {
      var self = this, client = this.client, reading = kind === 'temperature' || kind === 'humidity';
      var T = M.accType(kind);
      var href = this.picker('count-add:' + kind, { title: 'Add to ' + (T ? T[1] : 'Also Count'), value: null, multi: true,
        items: function () {
          return self.entityIds({ domains: ck.also || ck.domains || [], shown: true }).filter(function (id) {
            if (ck.found.indexOf(id) >= 0 || ck.exclude.indexOf(id) >= 0) return false;
            if (!reading) return true;
            var a = (client.states[id] || {}).attributes || {};
            return id.indexOf('climate.') === 0 ? ('current_' + kind) in a : a.device_class === kind;
          }).map(function (id) { return { value: id, label: self.name(id), sub: (self.areaName(self.areaOf(id)) || 'No room') + ' · ' + id }; });
        },
        onPick: function (v) {
          var ids = [].concat(v || []);
          if (!ids.length) return;
          var o = {}; o[kind] = true;
          self.save({ type: DOMAIN + '/hidden/also', entity_ids: ids, kinds: o }, [], function () {}, function () {})
            .then(function (ok) { if (ok) self.reload().then(function () { self.render(); }); });
        } });
      return K.nav({ label: 'Add…', href: href, fk: 'inc:add' });
    }
    // THE WEATHER PAGE'S OWN (2026-10-16): the weather service and its
    // sensors (shared with the header, Climate and the screensaver), then what
    // the Weather page shows and its radar (weather.page / weather.radar_native,
    // the page's alone)
    h_weather(c) {
      var self = this, set = function (k) { return function (v) { var o = {}; o[k] = v; self.setH(o); }; };
      var place = (this.client.config && this.client.config.location_name) || 'Home';
      c.appendChild(K.group({ header: 'Weather Source', footer: 'The header, Climate and the screensaver use these too. Place: the name over the temperature; empty, this home’s name, ' + String(place).toUpperCase() + '.' }, [
        this.entityRow({ label: 'Weather Service', sk: 'weather.entity', value: this.hs('weather.entity'), none: 'First Weather Entity',
                         filter: { domains: ['weather'] }, onPick: set('weather.entity') }),
        K.text({ label: 'Place', sk: 'weather.place', value: this.hs('weather.place'), placeholder: place, maxlength: 60,
                 error: this.err('weather.place'), onCommit: function (v) { self.setH({ 'weather.place': v }); } })]));
      var pg = M.wxPage(this.data.settings), r = M.radarOf(this.data.settings), plan = M.radarPlanOf(r, this.client);
      c.appendChild(K.group({ header: 'Forecast', footer: 'What the Weather page shows. Only on this page: the header and the screensaver keep their own.' }, [
        K.nav({ label: 'Forecast & Details', value: M.forecastSummary(pg), href: '#/page/weather/forecast', sk: 'weather.page' })]));
      var keys = ['feels_like', 'humidity', 'wind', 'gust', 'uv', 'outside', 'forecast_daily', 'forecast_hourly', 'alerts'];
      var n = keys.filter(function (k) { return self.hs('weather.' + k); }).length;
      c.appendChild(K.group({ header: 'Optional Readings', footer: 'Sensors are optional: without one, the weather service’s own reading is used.' }, [
        K.nav({ label: 'Sensors', value: n ? n + ' Chosen' : 'None', href: '#/page/weather/sensors', sk: 'weather.sensors' })]));
      c.appendChild(K.group({ header: 'Radar', footer: r.enabled && plan.reason ? M.RADAR_REASONS[plan.reason] : 'A precipitation radar map beside the daily forecast.' }, [
        K.nav({ label: 'Radar Map', value: M.radarSummary(r, plan), href: '#/page/weather/radar', sk: 'weather.radar_native' })]));
      c.appendChild(K.group({ header: 'Presentation', footer: 'Each card’s contents build when the page opens, as on the Energy page; the cards stay in place. Not with Reduce Motion.' }, [
        K.toggle({ label: 'Animate Page Loading', on: pg.load_animation, sk: 'weather.page.load_animation',
                   onChange: function (on) { self.wxPageSet({ load_animation: on }); } })]));
    }
    // one key of the page's composition: the whole object goes (the
    // integration checks it whole)
    wxPageSet(changes) {
      return this.setH({ 'weather.page': Object.assign(M.wxPage(this.data.settings), changes) });
    }
    radarSet(changes) {
      this.radarCheckStop();
      return this.setH({ 'weather.radar_native': Object.assign(M.radarOf(this.data.settings), changes) });
    }
    h_weatherForecast(c) {
      var self = this, pg = M.wxPage(this.data.settings);
      var tog = function (k, label, sub, dim) {
        var o = {}; return K.toggle({ label: label, sub: sub, on: pg[k], sk: 'weather.page.' + k, disabled: !!dim && !pg[k],
                                      onChange: function (on) { o[k] = on; self.wxPageSet(o); } });
      };
      var alerts = this.hs('weather.alerts');
      c.appendChild(K.group({ header: 'Show', footer: 'Weather Alerts appear only while an alert is in effect' +
          (alerts ? '.' : ', from an Alerts sensor (Optional Readings → Sensors).') }, [
        tog('show_current', 'Current Conditions'), tog('show_hourly', 'Hourly Forecast'), tog('show_daily', 'Daily Forecast'),
        tog('show_alerts', 'Weather Alerts', alerts ? null : 'Needs the NWS Alerts integration (US only) and its sensor', !alerts)]));
      c.appendChild(K.group({ header: 'Hourly Forecast', footer: 'Up to this many hours, as many as the weather service gives; they scroll sideways where they don’t fit. ' +
          'The view it opens on; a reading the service doesn’t give falls back to Temperature.' }, [
        K.seg({ label: 'Hours', sk: 'weather.page.hours', value: pg.hours, options: M.WX_HOURS,
                onChange: function (v) { self.wxPageSet({ hours: v }); } }),
        K.seg({ label: 'Default View', sk: 'weather.page.hourly_metric', value: pg.hourly_metric, options: M.WX_METRICS,
                onChange: function (v) { self.wxPageSet({ hourly_metric: v }); } })]));
      c.appendChild(K.group({ header: 'Daily Forecast', footer: 'Only the days the weather service gives — some give fewer.' }, [
        K.seg({ label: 'Days', sk: 'weather.page.days', value: pg.days, options: M.WX_DAYS,
                onChange: function (v) { self.wxPageSet({ days: v }); } })]));
      var label = function (k) { var d = M.WX_DETAILS.filter(function (x) { return x[0] === k; })[0]; return d || [k, k, null]; };
      c.appendChild(K.listEditor({ fk: 'wxdetails', announce: this.announce.bind(this),
        rows: pg.details.map(function (k) { var d = label(k); return { value: k, label: d[1], icon: d[2] }; }),
        more: M.WX_DETAILS.filter(function (d) { return pg.details.indexOf(d[0]) < 0; })
          .map(function (d) { return { value: d[0], label: d[1], icon: d[2] }; }),
        shownHeader: 'Details', moreHeader: 'More Details', emptyText: 'No details',
        shownFooter: 'The tiles under the forecast, in this order. One the weather service doesn’t give says so rather than disappearing.',
        onChange: function (v) { self.wxPageSet({ details: v }); } }));
      c.appendChild(K.group({ footer: 'Puts the forecast, the details and the animation back to how they came. The weather service, sensors and radar stay.' }, [
        K.button({ label: 'Reset Forecast & Details', fk: 'weather.page.reset', destructive: true,
                   onClick: function () { self.setH({ 'weather.page': JSON.parse(JSON.stringify(M.WX_PAGE_DEFAULTS)) }); } })]));
    }
    // THE RADAR MAP (hk-radar.js): HK's own, over OpenStreetMap
    h_radar(c) {
      var self = this, r = M.radarOf(this.data.settings), plan = M.radarPlanOf(r, this.client);
      var rows = [K.toggle({ label: 'Show Radar', on: r.enabled, sk: 'weather.radar_native.enabled',
                             onChange: function (on) { self.radarSet({ enabled: on }); } })];
      var says = r.enabled ? (plan.reason ? M.RADAR_REASONS[plan.reason]
        : 'Showing ' + M.RADAR_NAMES[plan.provider] + ' radar around ' + plan.place + '.' +
          (plan.provider === 'noaa' && plan.country && plan.country !== 'US' ? ' NOAA covers the United States only.' : '')) : null;
      if (r.enabled) {
        var auto = plan.country ? (plan.country === 'US' ? 'NOAA' : 'RainViewer') : null;
        rows.push(K.select({ label: 'Radar Provider', sk: 'weather.radar_native.provider', value: r.provider,
          options: M.RADAR_PROVIDERS.map(function (p) { return p[0] === 'auto' && auto ? ['auto', 'Automatic (' + auto + ')', auto] : p; }),
          onChange: function (v) { self.radarSet({ provider: v }); } }));
        rows.push(K.select({ label: 'Base Map', sk: 'weather.radar_native.basemap', value: r.basemap, options: M.RADAR_BASEMAPS,
          onChange: function (v) { self.radarSet({ basemap: v }); } }));
        rows.push(K.seg({ label: 'Map Location', sk: 'weather.radar_native.center', value: r.center, options: M.RADAR_CENTERS,
          onChange: function (v) { self.radarSet({ center: v }); } }));
        if (r.center === 'zone') {
          rows.push(this.entityRow({ label: 'Zone', sk: 'weather.radar_native.zone', value: r.zone, none: 'Choose a Zone',
                                     filter: { domains: ['zone'] }, onPick: function (v) { self.radarSet({ zone: v || null }); } }));
        }
        rows.push(K.nav({ label: 'Advanced', value: M.radarAdvancedSummary(r), href: '#/page/weather/radar/advanced', sk: 'weather.radar_native.advanced' }));
      }
      c.appendChild(K.group({ footer: r.enabled
        ? says + ' Loads map and radar imagery for the displayed area from the selected services. Internet access required.'
        : 'A precipitation radar map on the Weather page, beside the daily forecast. Nothing is loaded while it’s off.' }, rows));
      if (r.enabled) this.radarCheckGroup(c, r, plan);
      // the providers: who they are, what they cost, where they reach
      var link = function (href, text) { return h('a', { href: href, target: '_blank', rel: 'noopener', text: text }); };
      var about = function (text, href, ltext) {
        return h('p', { style: 'margin:0 0 6px' }, [h('span', { text: text + ' ' }), h('a', { href: href, target: '_blank', rel: 'noopener', text: ltext })]);
      };
      c.appendChild(K.group({ header: 'About the Map', footer: h('div', {}, [
        about('NOAA (US): the National Weather Service’s MRMS radar, free, for the United States, Alaska, Hawaii and the Caribbean.',
              'https://www.weather.gov/disclaimer', 'NOAA/NWS terms'),
        about('RainViewer: worldwide, free for personal use, credited on the map, with no guarantee. Its radar stops at a middling zoom.',
              'https://www.rainviewer.com/api.html', 'RainViewer terms'),
        about('The street map is OpenStreetMap’s, whose public tiles are for light personal use, credited on the map.',
              'https://operations.osmfoundation.org/policies/tiles/', 'Tile usage policy')]) }, []));
      var legacy = this.hs('weather.radar') || {};
      if (Object.keys(legacy).length) {
        var odd = Object.keys(legacy).filter(function (k) { return M.RADAR_LEGACY_MAPPED.indexOf(k) < 0; });
        c.appendChild(K.group({ header: 'From the Weather Radar Card', footer: odd.length
          ? odd.length + (odd.length === 1 ? ' option has' : ' options have') + ' no equivalent here and ' + (odd.length === 1 ? 'is' : 'are') + ' kept, unused: ' + odd.join(', ') + '.'
          : 'Its zoom, radar, map movement and playback options were carried over.' }, [
          K.nav({ label: 'Weather Radar Card Options', value: String(Object.keys(legacy).length), href: '#/page/weather/radar/yaml', sk: 'weather.radar' })]));
      }
      c.appendChild(K.group({ footer: 'Turns the radar off and puts every radar setting back to its default.' }, [
        K.button({ label: 'Reset Radar', fk: 'weather.radar_native.reset', destructive: true,
                   onClick: function () { self.radarSet(JSON.parse(JSON.stringify(M.RADAR_DEFAULTS))); } })]));
    }
    h_radarAdvanced(c) {
      var self = this, r = M.radarOf(this.data.settings);
      var tog = function (k, label, sub) {
        var o = {}; return K.toggle({ label: label, sub: sub, on: r[k], sk: 'weather.radar_native.' + k,
                                      onChange: function (on) { o[k] = on; self.radarSet(o); } });
      };
      c.appendChild(K.group({ header: 'Map', footer: 'Higher is closer. RainViewer’s radar stops at its own closest level; closer than that the map still zooms and the radar is drawn larger, not sharper.' }, [
        K.select({ label: 'Initial Zoom', sk: 'weather.radar_native.zoom', value: String(r.zoom),
                   options: [4, 5, 6, 7, 8, 9, 10].map(function (n) { return [String(n), String(n)]; }),
                   onChange: function (v) { self.radarSet({ zoom: Number(v) }); } }),
        tog('marker', r.center === 'zone' ? 'Location Marker' : 'Home Marker'),
        tog('interactive', 'Move and Zoom Expanded Map', 'The page stays centered on your location. Pan and zoom are available only in the expanded map.'),
        K.slider({ label: 'Radar Opacity', sk: 'weather.radar_native.opacity', value: r.opacity, min: 20, max: 100, step: 5, unit: '%',
                   onChange: function (v) { self.radarSet({ opacity: v }); } })]));
      c.appendChild(K.group({ header: 'Playback', footer: 'Only the frames the provider has. Plays automatically on page entry, including in Flat. Reduce Motion waits for a tap, and waking never restarts playback by itself.' }, [
        K.select({ label: 'History', sk: 'weather.radar_native.history_minutes', value: String(r.history_minutes),
                   options: M.RADAR_HISTORY.map(function (x) { return [String(x[0]), x[1]]; }),
                   onChange: function (v) { self.radarSet({ history_minutes: Number(v) }); } }),
        K.seg({ label: 'Speed', sk: 'weather.radar_native.playback_speed', value: r.playback_speed, options: M.RADAR_SPEEDS,
                onChange: function (v) { self.radarSet({ playback_speed: v }); } }),
        tog('autoplay', 'Play on Open'),
        K.info({ label: 'Playback Controls', value: 'Expanded Map Only', sub: 'The page shows a centered regional view with an expand button. Open it for playback, pan and zoom.' })]));
    }
    // the Weather Radar Card's own options, kept from before 1.16: read only
    h_radarLegacy(c) {
      var legacy = this.hs('weather.radar') || {};
      var rows = Object.keys(legacy).map(function (k) {
        var v = legacy[k], t = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return K.info({ label: k, sub: M.RADAR_LEGACY_MAPPED.indexOf(k) >= 0 ? 'Carried over' : 'No equivalent: unused', value: t.length > 40 ? t.slice(0, 39) + '…' : t });
      });
      if (!rows.length) rows.push(K.info({ label: 'Options', value: 'None' }));
      c.appendChild(K.group({ footer: 'The Weather Radar Card’s options from before HK drew its own radar, kept as they were. They no longer change the Weather page; the card itself still works on dashboards of your own.' }, rows));
    }
    // CHECK RADAR CONNECTION: on a tap only -- the provider's frames and one
    // small current image of the map's area -- never in the background.
    // Stopped by leaving the page or changing a radar setting.
    radarCheckStop() {
      if (this._rcheck) { this._rcheck.ctl.abort(); this._rcheck = null; }
    }
    radarCheckGroup(c, r, plan) {
      var self = this, sig = JSON.stringify([r, plan.provider, plan.lat, plan.lon]);
      var res = this._rcheckRes && this._rcheckRes.sig === sig ? this._rcheckRes : null;
      var rows = [K.button({ label: this._rcheck ? 'Checking…' : 'Check Radar Connection', fk: 'weather.radar_native.check',
                             sk: 'weather.radar_native.check', disabled: !!this._rcheck || !!plan.reason,
                             onClick: function () { self.radarCheck(sig, plan, r); } })];
      if (res && res.ok) {
        rows.push(K.info({ label: 'Provider', value: M.RADAR_NAMES[res.provider] }));
        rows.push(K.info({ label: 'Latest Radar', value: res.latestText }));
        rows.push(K.info({ label: 'History Available', value: res.framesText }));
        rows.push(K.info({ label: 'This Area', value: res.coverageText }));
      } else if (res) rows.push(K.info({ label: 'Couldn’t Connect', sub: res.error }));
      c.appendChild(K.group({ header: 'Connection', footer: 'Asks the provider for its latest frames and one small image of the map’s area, once.' }, rows));
    }
    radarCheck(sig, plan, r) {
      var self = this, route = location.hash;
      this.radarCheckStop();
      var ctl = new AbortController();
      this._rcheck = { ctl: ctl };
      var stop = function () { if (location.hash !== route) self.radarCheckStop(); };
      window.addEventListener('hashchange', stop);
      this.render();
      import('/hk/modules/hk-radar.js').then(function () {
        return window.hkRadar.check(plan, r, ctl.signal);
      }).then(function (got) { return got; }, function (e) {
        return { ok: false, error: (e && e.name === 'AbortError') ? null : String((e && e.message) || e) };
      }).then(function (got) {
        window.removeEventListener('hashchange', stop);
        if (ctl.signal.aborted || !got || got.error === null) return;
        self._rcheck = null;
        self._rcheckRes = Object.assign({ sig: sig }, got);
        if (location.hash === route) self.render();
      });
    }
    // THE CALENDARS the Calendar page and the screensaver's calendar pane
    // show: every calendar, A to Z (automatic), or the ones chosen, in order;
    // each with its colour (its own page)
    calIds() {
      var st = (this.client && this.client.states) || {};
      return Object.keys(st).filter(function (k) { return k.indexOf('calendar.') === 0; }).sort();
    }
    calColor(id, shown) {
      var own = (this.hs('calendar.colors') || {})[id];
      if (own) return { key: own, auto: false };
      var i = shown.indexOf(id);
      return { key: M.CAL_COLORS[(i < 0 ? 0 : i) % M.CAL_COLORS.length], auto: true };
    }
    // ALL SCREENS -> NOW PLAYING: a side pane (the screensaver's music pane)
    // or the bar on tablets & computers, the bar on phones (hk-base.js
    // nowPlaying, hk-popup.js placeFor). Each screen may choose its own
    // (its Behavior rows, np_*).
    h_nowPlaying(c) {
      var self = this, np = this.npHouse(), wide = this.hasAttribute('wide');
      var set = function (k, v) { var o = {}; o['now_playing.' + k] = v; self.setH(o); };
      var rows = [K.seg({ label: 'Show As', sk: 'now_playing.style', value: np.style, options: M.NP_STYLES,
                          onChange: function (v) { set('style', v); } })];
      if (np.style === 'pane') {
        rows.push(K.seg({ label: 'Pane Side', sk: 'now_playing.side', value: np.side, options: M.NP_SIDES,
                          onChange: function (v) { set('side', v); } }));
        rows.push(K.info({ label: 'Too Narrow for the Pane', sub: 'Held upright, or too narrow beside the page', value: 'Use the Bar',
                           sk: 'now_playing.narrow' }));
      } else {
        rows.push(K.seg({ label: 'Bar Position', sk: 'now_playing.bar', value: np.bar, options: M.NP_BARS,
                          onChange: function (v) { set('bar', v); } }));
      }
      var gl = M.choiceLabel(M.NP_GRACES, np.grace).toLowerCase();
      c.appendChild(K.group({ header: 'Tablets & Computers', footer: np.style === 'pane'
        ? 'The pane slides in when music starts and leaves ' + gl + ' after it’s paused or stops. The page fits itself into the width that’s left.'
        : 'The bar slides in when music starts and leaves ' + gl + ' after it’s paused or stops.' }, rows));
      c.appendChild(K.group({ header: 'Phones', footer: 'Phones always use the bar. A pane would leave no room for the page.' }, [
        K.seg({ label: 'Bar Position', sk: 'now_playing.bar_phone', value: np.bar_phone, options: M.NP_BARS,
                onChange: function (v) { set('bar_phone', v); } })]));
      // HIDE AFTER A PAUSE: the bar, the pane and the screensaver's music,
      // held longer while somebody is using it
      c.appendChild(K.group({ header: 'Paused or Stopped', footer: 'How long Now Playing stays once the music is paused or stops — ' +
          'the bar, the pane and the screensaver’s music alike. While someone is using it (Speakers or Browse open, a tap on it), ' +
          'it stays, and waits this long again after.' }, [
        K.select({ label: 'Hide After', sk: 'now_playing.grace', value: String(np.grace),
                   options: M.NP_GRACES.map(function (g) { return [String(g[0]), g[1]]; }),
                   onChange: function (v) { set('grace', Number(v)); } })]));
      // the screens that choose their own, as other Same as All Screens pages list them
      var own = [], bd = this.data.boards || {};
      Object.keys(bd).forEach(function (pth) {
        var b = bd[pth] || {};
        if (b.np_style || b.np_side || b.np_bar || b.np_bar_phone) own.push(K.nav({ label: (self.dash(pth) || {}).title || pth, value: M.npSummary(b, np),
          href: '#/screens/' + encodeURIComponent(pth), sk: 'np:screen:' + pth }));
      });
      if (own.length) c.appendChild(K.group({ header: 'Screens With Their Own', footer: 'These screens choose their own under Behavior.' }, own));
      void wide;
    }
    npHouse() {
      return Object.assign({ style: 'bar', side: 'right', bar: 'bottom', bar_phone: 'bottom', grace: 30 }, (this.data.settings || {}).now_playing || {});
    }

    h_calendar(c) {
      var self = this, mine = this.hs('calendar.entities') || [], all = this.calIds();
      var auto = !mine.length, shown = auto ? all : mine;
      var set = function (v) { self.setH({ 'calendar.entities': v }); };
      var row = function (id) {
        var col = self.calColor(id, shown);
        return { value: id, label: self.name(id), href: '#/page/calendar/' + id,
                 value2: col.auto ? 'Automatic (' + M.colorLabel(col.key) + ')' : M.colorLabel(col.key) };
      };
      if (!all.length) {
        c.appendChild(K.group({ footer: 'Add a calendar to Home Assistant (Settings → Devices & Services → Add Integration → Local Calendar, Google Calendar or CalDAV) and it shows here.' }, [
          K.info({ label: 'Calendars', value: 'None' })]));
        return;
      }
      c.appendChild(K.listEditor({ fk: 'calendars', auto: auto, announce: this.announce.bind(this),
        autoFooter: auto ? 'Every calendar in Home Assistant, A to Z. Turn off Automatic to choose them and their order.'
                         : 'Only these calendars, in this order.',
        onAuto: function (on) { set(on ? [] : all.slice()); },
        shownHeader: 'Calendars', emptyText: 'None', shownFooter: 'The Calendar page and the screensaver’s calendar pane show these. Select one for its color.',
        rows: shown.map(row), onChange: set, addLabel: auto ? null : 'Add Calendar…',
        onAddOther: auto ? null : function () {
          self.go(self.picker('calendar-add', { title: 'Add Calendar', value: null, multi: true,
            items: function () { return all.filter(function (id) { return mine.indexOf(id) < 0; })
              .map(function (id) { return { value: id, label: self.name(id), sub: id }; }); },
            onPick: function (id) { if (id) set(mine.concat(id)); } }));
        } }));
      this.h_calendarKeywords(c);
    }
    // COLORS BY KEYWORD (2026-10-16): an event whose title has the word
    // ("Doctor", "Emma") takes its color, the first that matches; an
    // event's own color, picked on its sheet, wins over them
    h_calendarKeywords(c) {
      var self = this, list = (this.hs('calendar.keywords') || []).slice();
      var save = function (next) { self.setH({ 'calendar.keywords': next }); };
      var opts = M.PILL_COLORS.map(function (k) { return [k, M.colorLabel(k)]; }).concat([['__remove', 'Remove']]);
      var rows = list.map(function (k, i) {
        return K.select({ label: k.word, sk: 'calendar.keywords', fk: 'kw:' + i, value: k.color, options: opts,
          onChange: function (v) {
            var next = list.slice();
            if (v === '__remove') next.splice(i, 1); else next[i] = { word: k.word, color: v };
            save(next);
          } });
      });
      rows.push(K.text({ label: 'Add a Keyword', sk: 'calendar.keywords', fk: 'kw:add', value: '', placeholder: 'Doctor',
        error: this.err('calendar.keywords'),
        onCommit: function (t) {
          var w = String(t || '').trim();
          if (!w || list.some(function (k) { return k.word.toLowerCase() === w.toLowerCase(); })) return;
          var used = list.map(function (k) { return k.color; });
          var col = M.PILL_COLORS.filter(function (k) { return k !== 'white' && used.indexOf(k) < 0; })[0] || 'red';
          save(list.concat([{ word: w, color: col }]));
        } }));
      c.appendChild(K.group({ header: 'Colors by Keyword', footer: 'An event with one of these words in its name takes its color — the first that matches, in any case. ' +
          'Tap an event on the Calendar page to give it a color of its own.' }, rows));
    }
    h_calendarOne(c, id) {
      var self = this, mine = this.hs('calendar.entities') || [], shown = mine.length ? mine : this.calIds();
      var all = Object.assign({}, this.hs('calendar.colors') || {});
      var i = shown.indexOf(id), autoKey = M.CAL_COLORS[(i < 0 ? 0 : i) % M.CAL_COLORS.length];
      var st = this.client && this.client.states[id], f = (st && st.attributes && st.attributes.supported_features) || 0;
      var can = [f & 1 ? 'added' : null, f & 4 ? 'changed' : null, f & 2 ? 'deleted' : null].filter(Boolean);
      c.appendChild(K.group({ footer: 'Its events’ color on the Calendar page and the screensaver. Automatic: the next color by its place in the list.' }, [
        K.select({ label: 'Color', sk: 'calendar.colors', value: all[id] || '', placeholder: 'Automatic',
                   options: [['', 'Automatic (' + M.colorLabel(autoKey) + ')']]
                     .concat(M.PILL_COLORS.map(function (k) { return [k, M.colorLabel(k)]; })),
                   onChange: function (v) {
                     var out = Object.assign({}, all);
                     if (v) out[id] = v; else delete out[id];
                     self.setH({ 'calendar.colors': out });
                   } })]));
      c.appendChild(K.group({ footer: can.length
          ? 'Events can be ' + (can.length > 1 ? can.slice(0, -1).join(', ') + ' and ' + can[can.length - 1] : can[0]) + ' from the Calendar page.'
          : 'This calendar can only be read: its events can’t be added or changed from the Calendar page.' }, [
        K.info({ label: 'Entity', value: id })]));
    }
    h_weatherSensors(c) {
      var self = this, set = function (k) { return function (v) { var o = {}; o[k] = v; self.setH(o); }; };
      var row = function (key, label, none, dc, sub) {
        return self.entityRow({ label: label, sub: sub, sk: 'weather.' + key, value: self.hs('weather.' + key), none: none,
                                filter: { domains: ['sensor'], dc: dc }, onPick: set('weather.' + key) });
      };
      c.appendChild(K.group({ header: 'Now', footer: 'Empty: the weather service’s own reading.' }, [
        row('feels_like', 'Feels Like', 'From Weather Service'), row('humidity', 'Humidity', 'From Weather Service'),
        row('wind', 'Wind Speed', 'From Weather Service'), row('gust', 'Wind Gust', 'Not Shown'),
        row('uv', 'UV Index', 'Not Shown'),
        row('outside', 'Outside Temperature', 'Not Shown', 'temperature', 'The Weather page’s daily averages')]));
      c.appendChild(K.group({ header: 'Forecast', footer: 'A sensor with a forecast attribute. Empty: the forecast is read from the weather service.' }, [
        row('forecast_daily', 'Daily Forecast', 'From Weather Service'), row('forecast_hourly', 'Hourly Forecast', 'From Weather Service')]));
      c.appendChild(K.group({ header: 'Alerts', footer: 'The NWS Alerts integration’s sensor (US only; without it there are no alerts). Its alert chip and card show only while an alert is active.' }, [
        row('alerts', 'Weather Alerts', 'None')]));
    }
    h_appearance(c) {
      var self = this, look = this.data.settings.look, boards = this.data.boards;
      var own = Object.keys(boards).filter(function (p) { return M.glassOf(boards[p], look).own; });
      var style = look.flat === true ? 'flat' : look.glass;
      // THE STYLE'S OWN SETTINGS ONLY (2026-10-09): Frost and Tint from
      // Background with Frosted, Blur with the blurs -- as a screen's page
      // shows them. A screen with a style of its own sets them there.
      var rows = [K.nav({ label: 'Appearance Style', value: M.glassLabel(style), href: '#/house/appearance/glass', sk: 'look.glass' })];
      rows = rows.concat(this.glassRows(style, {
        frost: { value: look.frost, onChange: function (v) { self.setH({ 'look.frost': v }); } },
        tint: { on: !!look.frost_tint, onChange: function (on) { self.setH({ 'look.frost_tint': on }); } },
        blur: { value: look.blur, onChange: function (v) { self.setH({ 'look.blur': v }); } },
        dark: { value: typeof look.tint === 'number' ? look.tint : 50, onChange: function (v) { self.setH({ 'look.tint': v }); } },
        well: { value: look.well || 'dark', onChange: function (v) { self.setH({ 'look.well': v }); } }
      }, 'look.'));
      var names = own.map(function (p) { var x = self.dash(p); return x ? x.title : p; });
      if (style === 'flat') rows = rows.concat(this.flatThemeRows(null, look, null));
      // FLAT COLORS: while All Screens wears Flat -- or any screen does, as
      // the colors those screens inherit
      var hsc = this.flatScope('house');
      if (style === 'flat' || this.flatAnywhere()) rows.push(this.flatColorsNav(hsc, { sub: style === 'flat' ? null : 'For Screens Using Flat' }));
      var hseed = style === 'flat' && hsc.resolved().accent.value !== 'auto';
      rows.push(K.nav({ label: 'Highlight Color', value: M.accentOf((this.data.settings.menu || {}).accent).name, href: '#/house/menu/accent', sk: 'menu.accent',
                        sub: hseed ? 'In Flat, the Accent Color' : null }));
      rows.push(K.nav({ label: 'Sky / Background', href: '#/house/sky', sk: 'sky.background' }));
      c.appendChild(K.group({ header: 'Appearance', footer: M.glassFooter(style) +
        (names.length ? ' ' + names.join(', ') + (names.length > 1 ? ' choose their own.' : ' chooses its own.') : '') }, rows));
      // PAGE PILLS (2026-10-09: edited inside a screen's Scenes before,
      // though every screen shares them)
      var pills = this.hs('look.page_pills') || {};
      // (each page's pill is on its own page, Pages -> the page -> Its Pill
      // on Home, since 2026-10-16; Page Pills lists them all, from search)
    }
    // EVERY PAGE PILL, each a way to its look
    h_pills(c) {
      var pills = this.hs('look.page_pills') || {};
      c.appendChild(K.group({ footer: 'A screen chooses which page pills its Scenes row shows; how each looks is the same everywhere.' },
        Object.keys(M.PAGE_PILL_DEFAULTS).map(function (k) {
          var d = M.PAGE_PILL_DEFAULTS[k], own = pills[k] || {};
          return K.nav({ label: own.name || d[0], sub: own.name ? d[0] : null, icon: own.icon || d[1],
                         value: Object.keys(own).length ? 'Customized' : '', href: '#/page/' + k + '/pill', fk: 'pill:' + k });
        })));
    }
    // THE ROWS UNDER GLASS STYLE, the same on All Screens' Appearance and a
    // screen's page: the amount of the style in use, with Frosted its Tint
    // from Background, with Tinted its Darkness (stored `tint`) and Icon
    // Circles (`well`). `v`: {frost, tint, blur, dark, well} -- each its value and
    // onChange, and on a screen `own`/`house`/`reset` for the inherited
    // pattern (Same as All Screens / Just This Screen, Reset to All Screens).
    glassRows(style, v, skp) {
      var rows = [], uses = M.amountsFor(style);
      // k: v's entry; key: the stored name, when it differs (Darkness is `tint`)
      var amount = function (k, label, key) {
        var a = v[k];
        key = key || k;
        rows.push(K.slider({ label: label, sk: skp + key, value: a.value, unit: '%', step: 5,
          badge: a.house != null && !a.own ? 'Same as All Screens' : null, onChange: a.onChange }));
        if (a.own) rows.push(K.button({ label: 'Reset to All Screens (' + a.house + '%)', sk: skp + key + ':reset', onClick: a.reset }));
      };
      if (uses.frost) {
        amount('frost', 'Frost');
        var t = v.tint;
        rows.push(K.toggle({ label: 'Tint from Background', sk: skp + 'frost_tint', on: t.on,
          sub: t.house == null ? null : (t.own ? 'Just This Screen' : 'Same as All Screens'), onChange: t.onChange }));
        if (t.own) rows.push(K.button({ label: 'Reset to All Screens (' + (t.house ? 'On' : 'Off') + ')', sk: skp + 'frost_tint:reset',
          onClick: t.reset }));
      }
      if (uses.blur) amount('blur', 'Blur');
      if (uses.tint && v.dark) {
        amount('dark', 'Darkness', 'tint');
        var w = v.well;
        rows.push(K.seg({ label: 'Icon Circles', sk: skp + 'well', value: w.value, options: M.TINT_WELLS,
          sub: w.house == null ? null : (w.own ? 'Just This Screen' : 'Same as All Screens'), onChange: w.onChange }));
        if (w.own) rows.push(K.button({ label: 'Reset to All Screens (' + M.choiceLabel(M.TINT_WELLS, w.house) + ')',
          sk: skp + 'well:reset', onClick: w.reset }));
      }
      return rows;
    }
    flatThemeRows(b, look, path) {
      var self = this, own = b && (b.flat_theme === 'light' || b.flat_theme === 'dark');
      var house = look.flat_theme === 'light' ? 'light' : 'dark';
      var rows = [K.seg({ label: 'Theme', sk: b ? 'b:flat_theme' : 'look.flat_theme',
        value: own ? b.flat_theme : house, options: [['light', 'Light'], ['dark', 'Dark']],
        sub: b ? (own ? 'Just This Screen' : 'Same as All Screens') : null,
        onChange: function (v) { if (b) self.setB(path, { flat_theme: v }); else self.setH({ 'look.flat_theme': v }); } })];
      if (own) rows.push(K.button({ label: 'Reset Theme to All Screens', sk: 'b:flat_theme:reset',
        onClick: function () { self.setB(path, { flat_theme: null }); } }));
      return rows;
    }
    h_glass(c) {
      var self = this, look = this.data.settings.look;
      this.glassChoices(c, look.flat === true ? 'flat' : look.glass || 'clear', 'blur', function (v) {
        self.setH(v === 'flat' ? { 'look.flat': true } : { 'look.flat': false, 'look.glass': v });
      }, 'hglass:');
      c.appendChild(K.group({ footer: 'Each screen can choose its own under its Appearance.' }, []));
    }
    h_sky(c) {
      var self = this, sky = this.data.settings.sky, look = this.data.settings.look;
      if (look.flat === true) { this.flatSky(c, null, null, '#/house/sky'); return; }
      // a screen in Flat while All Screens isn't: All Screens' Flat
      // backgrounds, which it follows, a tap away
      var flatOnes = Object.keys(this.data.boards || {}).filter(function (p) { return self.flatHere(self.data.boards[p]); });
      if (flatOnes.length) {
        c.appendChild(K.group({ footer: flatOnes.map(function (p) { var d = self.dash(p); return d ? d.title : p; }).join(', ') +
            (flatOnes.length > 1 ? ' wear' : ' wears') + ' Flat, which has backgrounds of its own.' }, [
          K.nav({ label: 'Flat Backgrounds', value: this.flatSummary(null), href: '#/house/sky/flat', sk: 'sky.flat_background' })]));
      }
      // THE BACKGROUND FIRST (2026-10-13): Live Sky, a still Color or a
      // Photo -- and below it only what that one needs. Before, a solid color
      // took turning off Animations, Weather, Rain & Snow and setting a
      // Backdrop, and the stars still showed through.
      var mode = sky.background || 'live';
      c.appendChild(K.group({ footer: M.BG_SAYS[mode] + ' Each screen, and each page, can choose its own.' }, [
        K.seg({ label: 'Background', sk: 'sky.background', value: mode, options: M.SKY_BACKGROUNDS, stack: !this.hasAttribute('wide'),
                onChange: function (v) { self.setH({ 'sky.background': v }); } })]));
      if (mode === 'color') {
        this.colorGroup(c, { id: sky.color || 'midnight', custom: sky.gradient_custom, fk: 'hcolor:',
          onPick: function (id) {
            var ch = { 'sky.color': id };
            if (id === 'custom' && !sky.gradient_custom) ch['sky.gradient_custom'] = self.dusk();
            self.setH(ch);
          },
          onCustom: function (v) { self.setH({ 'sky.gradient_custom': v }); }, scope: 'sky.gradient_custom' });
        this.skyPagesGroup(c, null, null);
        this.skyResetGroup(c, null, null);
        return;
      }
      if (mode === 'photo') {
        this.photoGroup(c, { url: sky.photo || null, fk: 'hphoto', sk: 'sky.photo',
          footer: 'Shown on Home, the room pages, and every page without a color of its own. Each screen can use a photo of its own.',
          onSet: function (url) { var was = sky.photo; self.setH({ 'sky.photo': url }).then(function (ok) { if (ok) self.photoForget(was); }); } });
        this.photoLookGroup(c, { look: sky.photo_look, sk: 'sky.photo_look', onSet: function (v) { self.setH({ 'sky.photo_look': v }); } });
        this.skyPagesGroup(c, null, null);
        this.skyResetGroup(c, null, null);
        return;
      }
      // LANDSCAPES (2026-10-14): HK Frontend's own photos -- which one, and
      // its own Look (a photo's, kept apart from your Photo's)
      if (mode === 'landscapes') {
        this.landscapeGroup(c, { value: sky.landscape || 'every:1440', fk: 'hland', sk: 'sky.landscape', href: '#/house/sky/landscape',
          footer: 'Shown on Home, the room pages, and every page without a color of its own. Each screen can choose its own.',
          onSet: function (v) { self.setH({ 'sky.landscape': v }); } });
        this.photoLookGroup(c, { look: sky.landscape_look, sk: 'sky.landscape_look', onSet: function (v) { self.setH({ 'sky.landscape_look': v }); } });
        this.skyPagesGroup(c, null, null);
        this.skyResetGroup(c, null, null);
        return;
      }
      // RAIN & SNOW only while there is weather to fall; PAUSE WHEN NOT IN
      // FOCUS only while anything moves (2026-10-10)
      var bg = [
        K.toggle({ label: 'Animations', sub: 'The moving parts — drifting clouds, falling rain and snow, the seasons, and a running fan’s spinning icon',
          sk: 'sky.animations', on: sky.animations !== false, onChange: function (on) { self.setH({ 'sky.animations': on }); } })];
      if (sky.animations !== false) {
        bg.push(K.toggle({ label: 'Pause When Not in Focus', sub: 'On a computer, everything holds still while another window is in front, ' +
            'and picks up where it left off when you come back. Saves most of the work the dashboard does while you aren’t looking',
          sk: 'sky.focus_pause', on: sky.focus_pause !== false, onChange: function (on) { self.setH({ 'sky.focus_pause': on }); } }));
        bg.push(K.seg({ label: 'Moving Things', sub: 'Rain and snow, falling leaves, bats and birds, flybys and confetti. ' +
            'In front, they cross over the cards — taps still go straight through to them. Fireworks, fog and clouds stay behind',
          sk: 'sky.moving', value: sky.moving || 'behind', options: M.SKY_MOVING, stack: !this.hasAttribute('wide'),
          onChange: function (v) { self.setH({ 'sky.moving': v }); } }));
      }
      bg.push(K.toggle({ label: 'Weather', sub: 'Clouds, rain, snow and fog. The sun, moon and stars stay',
          sk: 'sky.weather', on: sky.weather !== false, onChange: function (on) { self.setH({ 'sky.weather': on }); } }));
      if (sky.weather !== false) {
        bg.push(K.toggle({ label: 'Rain & Snow', sub: sky.animations === false
            ? 'Not shown while Animations are off — it can’t fall'
            : 'The falling rain and snow. Off, the clouds and fog still move, and it takes less work to draw',
          sk: 'sky.precipitation', on: sky.precipitation !== false, onChange: function (on) { self.setH({ 'sky.precipitation': on }); } }));
      }
      c.appendChild(K.group({ header: 'Live Sky' }, bg.concat([
        K.seg({ label: 'Clouds', sub: 'Classic drifting haze, or realistic photographic clouds', sk: 'sky.cloud_style',
          value: sky.cloud_style || 'classic', options: M.CLOUD_STYLES, stack: !this.hasAttribute('wide'),
          onChange: function (v) { self.setH({ 'sky.cloud_style': v }); } }),
        K.seg({ label: 'Daytime Sky', sub: 'How bright the daytime blue runs. Sunsets and nights are the same', sk: 'sky.daytime', stack: !this.hasAttribute('wide'),
          value: sky.daytime || 'natural', options: M.DAYTIME_SKIES,
          onChange: function (v) { self.setH({ 'sky.daytime': v }); } }),
        K.nav({ label: 'Sky Colors', sub: 'The live sky’s own colors, with its weather and decorations', value: this.backdropLabel(sky.gradient),
                href: '#/house/sky/backdrop', sk: 'sky.gradient' })])));
      this.skyPagesGroup(c, null, null);
      var rows = [K.toggle({ label: 'Seasonal Decorations', sk: 'sky.decorations', on: sky.decorations !== false,
                             onChange: function (on) { self.setH({ 'sky.decorations': on }); } })];
      rows.push(K.seg({ label: 'Decoration Style', sub: 'Holidays, seasons and special occasions', sk: 'sky.decoration_style',
        value: sky.decoration_style || 'old', options: [['old', 'Old Decorations'], ['new', 'New Decorations']], stack: !this.hasAttribute('wide'),
        onChange: function (v) { self.setH({ 'sky.decoration_style': v }); } }));
      rows.push(K.nav({ label: 'Woodland Between Occasions', sub: 'New Decorations, on days with no holiday',
        value: M.woodlandSummary(sky.woodland), href: '#/house/sky/woodland', sk: 'sky.woodland' }));
      if (sky.decorations !== false) {
        M.SKY_THEMES.forEach(function (t) {
          var on = (sky.themes || []).indexOf(t.id) >= 0;
          rows.push(K.nav({ label: t.label, value: on ? self.livelyValue(t.id) : 'Off', href: '#/house/sky/' + t.id, sk: 'sky:' + t.id }));
        });
      }
      var gate = sky.seasonal ? ' They also need ' + this.name(sky.seasonal) + ' to be on (Advanced).' : '';
      c.appendChild(K.group({ header: 'Seasonal Decorations', footer: 'What the live sky dresses up for. This is the same switch as Seasonal Decorations on the ' + haName('HK Frontend device') + '.' + gate }, rows));
      // LIVELINESS (2026-10-09): one preset for every holiday, occasion,
      // season and the Night Sky, or Custom -- each its own (Each Occasion)
      if (this.livelyMoves()) {
        var lrows = [K.select({ label: 'Liveliness', sub: 'How many little things move, and how often', sk: 'sky.liveliness_all',
          value: sky.liveliness_all || 'classic', options: M.LIVELY_ALL, onChange: function (v) { self.setH({ 'sky.liveliness_all': v }); } })];
        if (sky.liveliness_all === 'custom') {
          lrows.push(K.nav({ label: 'Each Occasion', sub: 'Every holiday, occasion, season and the Night Sky', href: '#/house/sky/lively',
                             sk: 'sky.liveliness', value: 'Custom' }));
        }
        c.appendChild(K.group({ header: 'Liveliness', footer: 'The decorations’ little moving things — bats, leaves, snow, ' +
            'fireflies — and the Night Sky’s stars. Custom sets each occasion its own. Each screen can choose its own.' }, lrows));
      }
      c.appendChild(K.group({ header: 'Sky Switch', footer: 'While this helper is off, no generated screen shows the live sky. A screen written in YAML names its own.' }, [
        this.entityRow({ label: 'Sky Switch', sk: 'look.sky_switch', value: look.sky_switch, none: 'None (Always On)',
                         filter: { domains: ['input_boolean', 'switch'] }, onPick: function (v) { self.setH({ 'look.sky_switch': v }); } })]));
      c.appendChild(K.group({}, [K.nav({ label: 'Advanced', sub: 'Hemisphere, sources, what decorations need', href: '#/house/sky/advanced' })]));
      this.skyResetGroup(c, null, null);
    }
    // RESET TO DEFAULTS (2026-10-14, the owner's ask): every setting on this
    // Sky / Background page goes back -- All Screens' to HK's defaults
    // (settings.py SKY_RESET, server side), a screen's to Same as All
    // Screens -- but never the Pages (each page's own background, photo and
    // look). A photo or custom colors you made are kept for next time.
    skyResetGroup(c, x, b) {
      var self = this;
      c.appendChild(K.group({ footer: b ? 'Every setting on this page goes back to Same as All Screens. The Pages keep their own backgrounds.'
                                        : 'Every setting on this page goes back to its default. The Pages keep their own backgrounds, and a photo or custom colors you made are kept for next time.' }, [
        K.button({ label: 'Reset to Defaults…', destructive: true, fk: b ? 'sky:screen-reset' : 'sky:house-reset', onClick: function () {
          K.confirm(self.shadowRoot, { title: b ? 'Use the Sky / Background for All Screens?' : 'Use the default Sky / Background?',
            message: b ? 'Every setting on this page goes back to Same as All Screens. Each page’s own background stays.'
                       : 'Every setting on this page goes back to its default: the Live Sky, with its weather, decorations and liveliness. Each page’s own background stays.',
            ok: 'Use Defaults', destructive: true }).then(function (yes) {
            if (!yes) return;
            if (!b) { self.setH({ 'sky.reset': true }); return; }
            var ch = { sky: true, sky_liveliness_occ: {}, sky_liveliness_custom: {}, sky_calm_empty: false };
            ['sky_background', 'sky_color', 'sky_landscape', 'sky_photo_look', 'sky_landscape_look', 'sky_animations', 'sky_focus_pause',
             'sky_moving', 'sky_weather', 'sky_precipitation', 'sky_cloud_style', 'sky_daytime', 'sky_gradient', 'sky_decorations',
             'sky_decoration_style', 'sky_liveliness', 'sky_flat_background', 'sky_flat_color', 'sky_flat_fade', 'sky_flat_tint', 'sky_flat_tint_amount', 'sky_flat_tint_light', 'sky_flat_image_look'].forEach(function (k) { ch[k] = null; });
            self.setB(x.path, ch);
          });
        } })]));
    }
    // HK FRONTEND'S OWN LANDSCAPES (2026-10-14), as the screensaver's clock
    // has them: the list from the folder's index.json (a home's own files
    // folder can answer with its own), fetched once; null until it comes.
    landscapes() {
      if (this._land) return this._land;
      if (!this._landAsk && typeof fetch === 'function') {
        var self = this;
        this._landAsk = true;
        fetch('/hk/landscapes/index.json').then(function (r) { return r.json(); }).then(function (j) {
          self._land = ((j && j.photos) || []).filter(function (p) { return p && typeof p.file === 'string' && LAND_FILE.test(p.file); });
          self.render(true);
        }).catch(function () { self._landAsk = false; });
      }
      return null;
    }
    // a landscape's picture: its small copy (`thumb`) for the grid, else the photo
    landSrc(p, big) {
      return '/hk/landscapes/' + (!big && typeof p.thumb === 'string' && /^thumbs\/[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(webp|jpe?g|png)$/i.test(p.thumb) ? p.thumb : p.file);
    }
    // WHICH LANDSCAPE, AND WHEN IT CHANGES (the owner's three): Each Time
    // the Screen Wakes, On a Schedule (with how often), or Stay the Same --
    // on the one showing now, or one picked (Choose a Landscape...). The one
    // showing now above them.
    //   o = { value (own; null following), house (All Screens', on a
    //         screen), onSet(v | null), href, fk, sk, footer }
    landscapeGroup(c, o) {
      var list = this.landscapes() || [], eff = o.value || o.house || 'every:1440', rows = [];
      var own = o.house === undefined ? eff : o.value;
      var kind = function (v) { return !v ? null : v === 'wake' ? 'wake' : /^every:/.test(v) ? 'every' : 'stay'; };
      var file = M.landscapeFile(eff, list), p = list.filter(function (x) { return x.file === file; })[0];
      if (p) {
        rows.push(h('div', { class: 'cell photoprev' }, [h('img', { src: this.landSrc(p, true), alt: p.title || 'The landscape', 'data-fk': o.fk + ':img' }),
          h('small', { text: (kind(eff) === 'wake' ? 'For now: ' : kind(eff) === 'every' ? 'Now: ' : '') + (p.title || '') })]));
      }
      if (o.house !== undefined) {
        rows.push(K.check({ label: 'Same as All Screens', sub: 'Now ' + M.landscapeLabel(o.house, list), on: !o.value, fk: o.fk + ':follow',
                            onClick: function () { o.onSet(null); } }));
      }
      rows.push(K.check({ label: 'Each Time the Screen Wakes', sub: 'A new one while the screensaver or the black is up, so it is there when the screen wakes',
                          on: kind(own) === 'wake', fk: o.fk + ':wake', onClick: function () { o.onSet('wake'); } }));
      rows.push(K.check({ label: 'On a Schedule', sub: kind(own) === 'every' ? M.landscapeLabel(own) : 'Every day, every hour …',
                          on: kind(own) === 'every', fk: o.fk + ':every', onClick: function () { if (kind(own) !== 'every') o.onSet('every:1440'); } }));
      if (kind(own) === 'every') {
        rows.push(K.select({ label: 'Change', sk: o.sk + ':every', value: own, options: M.LANDSCAPE_EVERY, onChange: function (v) { o.onSet(v); } }));
      }
      // Stay the Same: on the one showing now, until another is picked
      rows.push(K.check({ label: 'Stay the Same', sub: kind(own) === 'stay' ? M.landscapeLabel(own, list) : 'The one showing now, or one you choose',
                          on: kind(own) === 'stay', fk: o.fk + ':stay', onClick: function () { if (kind(own) !== 'stay' && file) o.onSet(file); } }));
      rows.push(K.nav({ label: 'Choose a Landscape', href: o.href, sk: o.sk }));
      c.appendChild(this.withError(K.group({ header: 'Landscape', footer: (o.footer ? o.footer + ' ' : '') +
        'Fifty photos that come with ' + PN() + ', all public domain or CC0, from Wikimedia Commons.' }, rows), o.sk));
    }
    // CHOOSE A LANDSCAPE: every one, small, the one it stays on ticked; a
    // tap picks it, and it stays (Stay the Same).
    landscapePick(c, o) {
      var self = this, list = this.landscapes();
      if (!list) { c.appendChild(K.group({}, [K.info({ label: 'Loading…', value: '' })])); return; }
      var grid = h('div', { class: 'landgrid' }, list.map(function (p) {
        var on = o.value === p.file;
        var bt = h('button', { class: on ? 'on' : '', type: 'button', title: p.title || p.file, 'aria-label': p.title || p.file,
                               'aria-pressed': on ? 'true' : 'false', 'data-fk': o.fk + ':' + p.file },
                   [h('img', { src: self.landSrc(p), alt: '', loading: 'lazy' })]);
        bt.addEventListener('click', function () { o.onSet(p.file); });
        return bt;
      }));
      c.appendChild(K.group({ header: 'Landscapes', footer: 'The one you choose stays (Stay the Same). To change it each time the screen wakes, or on a schedule, go back to Sky / Background.' },
                            [h('div', { class: 'cell landcell' }, [grid])]));
    }
    dusk() {
      var d = ((this.data.choices || {}).sky_backdrops || []).filter(function (p) { return p.id === 'dusk'; })[0];
      return d ? { day: d.day.slice(), night: d.night.slice() } : null;
    }
    // A STILL COLOR (the Background's Color, or a page's): the colors -- not
    // Live Sky -- with Same as All Screens first where there is one to follow.
    //   o = { id (own, or null following), follow: [label, id] (Same as ...),
    //         custom (stops), onPick(id | null), onCustom(stops), scope, fk }
    colorGroup(c, o) {
      var rows = [];
      if (o.follow) rows.push(K.check({ label: o.follow[0], sub: 'Now ' + this.backdropLabel(o.follow[1]), on: !o.id, fk: o.fk + 'follow',
                                        onClick: function () { o.onPick(null); } }));
      var all = this.backdropRows(o.id, o.custom, o.onPick, o.fk).filter(function (r) { return r.getAttribute('data-fk') !== o.fk + 'live'; });
      c.appendChild(K.group({ header: o.header || 'Color', footer: o.footer || 'The top of the screen to the bottom. Each has its day colors and, after sunset, its night ones.' }, rows.concat(all)));
      var eff = o.id || (o.follow && o.follow[1]);
      if (o.id === 'custom') this.customBackdrop(c, o.custom, o.scope, o.onCustom);
      else if (!o.id && eff === 'custom') c.appendChild(K.group({ footer: 'Custom’s colors are chosen where it is followed.' }, []));
    }
    // A PHOTO OF YOUR OWN (the Background's Photo, or a page's): what is
    // shown, Choose Photo... and Remove. Uploaded to Home Assistant's own
    // image store (image_upload, as a person's or an area's picture is),
    // made no bigger than 2560 px first -- a phone's 12-megapixel original
    // would cost a wall tablet ~48 MB to draw.
    //   o = { url (own), from (followed, shown when there is no own),
    //         fromLabel, onSet(url | null), fk, sk, header, footer }
    photoGroup(c, o) {
      var self = this, shown = o.url || o.from, rows = [], up = this._upl && this._upl.fk === o.fk ? this._upl : null;
      if (shown) {
        var im = h('img', { src: shown, alt: o.url ? 'The photo' : o.fromLabel, 'data-fk': o.fk + ':img' });
        rows.push(h('div', { class: 'cell photoprev' }, [im, o.url ? null : h('small', { text: o.fromLabel })]));
      }
      var inp = h('input', { type: 'file', accept: 'image/*', 'data-fk': o.fk + ':file', style: 'display:none' });
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        inp.value = '';
        if (f) self.photoUpload(f, o.fk).then(function (url) { if (url) o.onSet(url); });
      });
      if (up && up.busy) rows.push(K.info({ label: 'Uploading…', value: '' }));
      else rows.push(K.button({ label: o.url ? 'Choose Another Photo…' : 'Choose Photo…', fk: o.fk + ':choose', icon: 'mdi:image-plus', onClick: function () { inp.click(); } }));
      if (o.url && !(up && up.busy)) rows.push(K.button({ label: o.from ? 'Use ' + o.fromLabel : 'Remove Photo', destructive: !o.from, fk: o.fk + ':remove',
                                                          onClick: function () { o.onSet(null); } }));
      var g = K.group({ header: o.header || 'Photo', footer: !shown ? 'No photo yet: it shows Black until one is chosen. ' + (o.footer || '') : o.footer }, rows);
      g.appendChild(inp);
      c.appendChild(g);
      if (up && up.error) c.appendChild(h('div', { class: 'errline', role: 'alert', text: up.error }));
      if (o.sk && this.err(o.sk)) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err(o.sk) }));
    }
    // A PHOTO'S LOOK (2026-10-13): Blur, Dim, Saturation and a Color Tint --
    // one of the Color backdrops washed over it at Tint Strength. Each
    // change saves the whole look (settings.py photo_look).
    //   o = { look (as shown), own (a screen: its own, else All Screens'
    //         -- undefined for All Screens), onSet(look | null), fk, sk }
    photoLookGroup(c, o) {
      var L = Object.assign({ blur: 0, dim: 0, saturation: 100, tint: '', tint_amount: 35 }, o.look || {});
      var put = function (k, v) { var n = Object.assign({}, L); n[k] = v; o.onSet(n); };
      var colors = ((this.data.choices || {}).sky_backdrops || []).filter(function (p) { return p.id !== 'live'; });
      var rows = [
        K.slider({ label: 'Blur', sk: o.sk + ':blur', value: L.blur, min: 0, max: 100, unit: '%', onChange: function (v) { put('blur', v); } }),
        K.slider({ label: 'Dim', sk: o.sk + ':dim', value: L.dim, min: 0, max: 80, unit: '%', onChange: function (v) { put('dim', v); } }),
        K.slider({ label: 'Saturation', sub: '100% as taken; 0% black and white', sk: o.sk + ':saturation', value: L.saturation, min: 0, max: 200, step: 5, unit: '%',
                   onChange: function (v) { put('saturation', v); } }),
        K.select({ label: 'Color Tint', sub: 'One of the Colors, washed over it', sk: o.sk + ':tint', value: L.tint || '',
                   options: [['', 'None']].concat(colors.map(function (p) { return [p.id, p.label]; })),
                   onChange: function (v) { put('tint', v); } })];
      if (L.tint) rows.push(K.slider({ label: 'Tint Strength', sk: o.sk + ':tint_amount', value: L.tint_amount, min: 5, max: 80, step: 5, unit: '%',
                                       onChange: function (v) { put('tint_amount', v); } }));
      // back to what it follows, and back to the photo as taken
      var follow = o.follow || 'All Screens';
      if (o.own === true) rows.push(K.button({ label: 'Reset to ' + follow, sk: o.sk + ':reset', onClick: function () { o.onSet(null); } }));
      var asTaken = !L.blur && !L.dim && L.saturation === 100 && !L.tint;
      if (!asTaken) rows.push(K.button({ label: 'Reset to Default', sk: o.sk + ':default', onClick: function () {
        o.onSet({ blur: 0, dim: 0, saturation: 100, tint: '', tint_amount: 35 });
      } }));
      c.appendChild(this.withError(K.group({ header: 'Look', footer: (o.own === false ? 'Same as ' + follow + ' until you change it. ' : o.own ? 'Its own. ' : '') +
        'Reset to Default shows the photo as taken. Tint’s day colors show while the sun is up, its night ones after.' }, rows), o.sk));
    }
    async photoUpload(file, fk) {
      this._upl = { fk: fk, busy: true };
      this.render(true);
      try {
        var blob = await shrinkPhoto(file, 2560);
        var fd = new FormData();
        fd.append('file', blob, 'hk-background.jpg');
        var r = await this.actions().request('/api/image/upload', { method: 'POST', body: fd });
        if (!r.ok) throw new Error(r.status === 413 ? 'It’s too big.' : 'Home Assistant answered ' + r.status + '.');
        var j = await r.json();
        if (!j || !/^[0-9a-f]{32}$/.test(j.id || '')) throw new Error('Home Assistant didn’t say where it put it.');
        this._upl = null;
        return '/api/image/serve/' + j.id + '/original';
      } catch (e) {
        this._upl = { fk: fk, error: 'The photo couldn’t be uploaded. ' + ((e && e.message) || '') };
        this.render(true);
        return null;
      }
    }
    // a photo no longer used anywhere -- All Screens, a screen, a page --
    // leaves Home Assistant's image store (one HK uploaded: /api/image/serve)
    photoForget(url) {
      var m = /^\/api\/image\/serve\/([0-9a-f]{32})\/original$/.exec(url || '');
      if (!m) return;
      var d = this.data, used = [], sky = (d.settings || {}).sky || {};
      used.push(sky.photo);
      Object.keys(sky.page_photos || {}).forEach(function (k) { used.push(sky.page_photos[k]); });
      Object.keys(d.boards || {}).forEach(function (p) {
        var b = d.boards[p] || {};
        used.push(b.sky_photo);
        Object.keys(b.sky_page_photos || {}).forEach(function (k) { used.push(b.sky_page_photos[k]); });
      });
      if (used.indexOf(url) >= 0) return;
      this.actions().callWS({ type: 'image/delete', image_id: m[1] }).catch(function () { /* already gone */ });
    }
    // The picker reads choices from the server, just like dates and themes.
    // Loading the dashboard's settings module here would start its websocket
    // subscriptions merely to obtain a static palette table.
    backdropLabel(id) {
      var p = ((this.data.choices || {}).sky_backdrops || []).filter(function (p) { return p.id === (id || 'live'); })[0];
      return p ? p.label : 'Live Sky';
    }
    backdropRows(id, custom, pick, prefix) {
      return ((this.data.choices || {}).sky_backdrops || []).map(function (p) {
        var stops = p.day || (p.id === 'custom' && custom && custom.day);
        return K.check({ label: p.label, on: p.id === id, fk: prefix + p.id,
          tile: [p.id === 'live' ? 'mdi:weather-sunset' : 'mdi:palette',
                 stops ? 'linear-gradient(180deg, ' + stops.join(',') + ')' : C.purple],
          onClick: function () { pick(p.id); } });
      });
    }
    // Two sets of four native color controls. Keep edits during panel redraws
    // (a save's answer or the settings feed can redraw while the OS color
    // picker is open). Commit a snapshot on change; never hand setH/setB a
    // mutable draft.
    customBackdrop(c, stored, scope, save) {
      var fallback = ((this.data.choices || {}).sky_backdrops || []).filter(function (p) { return p.id === 'dusk'; })[0];
      if (!fallback) return;
      var source = stored || { day: fallback.day, night: fallback.night };
      var signature = JSON.stringify(source);
      this._skyDrafts = this._skyDrafts || {};
      var cache = this._skyDrafts[scope];
      if (!cache || cache.signature !== signature) {
        cache = this._skyDrafts[scope] = { signature: signature, stops: JSON.parse(signature) };
      }
      var rows = ['day', 'night'].map(function (key) {
        var label = key === 'day' ? 'Day' : 'Night';
        var colors = cache.stops[key].map(function (v, i) {
          var input = h('input', { type: 'color', 'aria-label': label + ' stop ' + (i + 1),
            'data-fk': scope + ':' + key + ':' + i });
          input.value = v;
          input.addEventListener('input', function () { cache.stops[key][i] = input.value; });
          input.addEventListener('change', function () {
            cache.stops[key][i] = input.value;
            save(JSON.parse(JSON.stringify(cache.stops)));
          });
          return input;
        });
        return h('div', { class: 'cell', 'data-sk': scope + ':' + key }, [K.label(label), h('div', { class: 'skycolors' }, colors)]);
      });
      c.appendChild(this.withError(K.group({ header: 'Custom Stops', footer: 'Four colors from the top of the sky to the horizon. Day when the sun is above the horizon; Night otherwise.' }, rows), scope.indexOf('b:') === 0 ? 'b:sky_custom' : scope));
    }
    // WOODLAND BETWEEN OCCASIONS: New Decorations' seasonal woodland on the
    // days with no holiday or birthday, season by season -- its own choice
    // (2026-10-04; summer's had been the Fourth of July's Show, autumn's
    // Thanksgiving's)
    h_woodland(c) {
      var self = this, on = this.data.settings.sky.woodland || [];
      // each season its own page: whether it shows, and its Liveliness
      c.appendChild(K.group({ footer: 'With New Decorations, the season\u2019s woodland shows on days with no holiday or ' +
          'birthday. A holiday\u2019s own Show still decides the holiday.' }, M.WOODLAND.map(function (w) {
        return K.nav({ label: w[1], value: on.indexOf(w[0]) >= 0 ? self.livelyValue(w[0]) : 'Off',
                       href: '#/house/sky/woodland/' + w[0], sk: 'sky.woodland:' + w[0] });
      })));
    }
    // A WOODLAND SEASON'S OWN PAGE: shown or not between occasions, and how
    // lively it is
    h_season(c, w) {
      var self = this, on = this.data.settings.sky.woodland || [], yes = on.indexOf(w[0]) >= 0;
      c.appendChild(K.group({ footer: 'New Decorations, on days with no holiday or birthday.' }, [
        K.toggle({ label: 'Show ' + w[1] + ' Woodland', sk: 'sky.woodland:' + w[0], on: yes, onChange: function (v) {
          self.setH({ 'sky.woodland': M.WOODLAND.map(function (x) { return x[0]; })
            .filter(function (x) { return x === w[0] ? v : on.indexOf(x) >= 0; }) });
        } })]));
      if (yes) this.livelyGroup(c, w[0]);
    }
    // THE NIGHT SKY (the forecast screensaver's): its twinkling stars and
    // shooting stars, every clear night of the year
    h_nightSky(c) {
      this.livelyGroup(c, 'night', 'The forecast screensaver\u2019s stars, every clear night.');
    }
    // An occasion's, a season's or the night's value on its row: On (Classic)
    // or its preset
    livelyValue(occ) {
      var sky = this.data.settings.sky || {};
      if ((sky.liveliness_all || 'classic') !== 'custom') return 'On';
      return 'On \u00b7 ' + M.livelyPresetLabel((sky.liveliness || {})[occ] || 'classic');
    }
    // the decoration styles in use: All Screens' and any screen's own
    livelyStyles() {
      var sky = this.data.settings.sky || {}, boards = this.data.boards || {}, out = {};
      out[sky.decoration_style || 'old'] = true;
      Object.keys(boards).forEach(function (p) { var st = boards[p] && boards[p].sky_decoration_style; if (st) out[st] = true; });
      return out;
    }
    // whether anything moves on any screen (Animations, All Screens' or a
    // screen's own)
    livelyMoves() {
      var sky = this.data.settings.sky || {}, boards = this.data.boards || {};
      return sky.animations !== false || Object.keys(boards).some(function (p) { return boards[p] && boards[p].sky_animations === true; });
    }
    // EVERY OCCASION THAT HAS LIVELINESS (settings.py LIVELY_OCCASIONS), in
    // its order: the holidays and occasions, the woodland seasons, the night
    livelyOccs() {
      var t = ((this.data.choices || {}).sky_lively || {}).occasions || {};
      return Object.keys(t);
    }
    // EACH OCCASION, All Screens' (lvl null) or a screen's ({b, path, base}):
    // its preset, each a way to its Liveliness
    livelyList(c, lvl) {
      var self = this, sky = this.data.settings.sky || {}, styles = this.livelyStyles();
      var lv = lvl ? (lvl.b.sky_liveliness_occ || {}) : (sky.liveliness || {});
      var table = (this.data.choices || {}).sky_lively;
      var rows = this.livelyOccs().filter(function (id) { return M.livelyKnobs(table, id, styles).length; }).map(function (id) {
        var href = lvl ? lvl.base + '/sky/lively/' + encodeURIComponent(id)
          : id === 'night' ? '#/house/sky/night'
          : M.WOODLAND.some(function (w) { return w[0] === id; }) ? '#/house/sky/woodland/' + id : '#/house/sky/' + id;
        return K.nav({ label: M.livelyOccLabel(id), value: M.livelyPresetLabel(lv[id] || 'classic'), href: href, fk: 'lively-occ:' + id });
      });
      c.appendChild(K.group({ footer: 'Each holiday, occasion, woodland season and the Night Sky: a preset, or Custom with each effect your own way.' +
          (lvl ? ' Just this screen.' : ' For every screen whose Liveliness is Same as All Screens.') }, rows));
    }
    // LIVELINESS (hk-sky.js lvOf) of one occasion, All Screens' (lvl null)
    // or a screen's ({b, path}): a preset, or Custom and each of the
    // occasion's knobs -- a slider for a count or a crossing, a switch for one
    // that is only on or off. Only the knobs a decoration style in use draws;
    // nothing at all while nothing moves. All Screens': only while its
    // Liveliness is Custom (else a way to it).
    livelyGroup(c, occ, foot, lvl) {
      var self = this, sky = this.data.settings.sky || {};
      var lv = lvl ? (lvl.b.sky_liveliness_occ || {}) : (sky.liveliness || {});
      var cust = lvl ? (lvl.b.sky_liveliness_custom || {}) : (sky.liveliness_custom || {});
      var cur = lv[occ] || 'classic';
      var knobs = M.livelyKnobs((this.data.choices || {}).sky_lively, occ, this.livelyStyles());
      if (!knobs.length) return;
      if (!this.livelyMoves()) {
        c.appendChild(K.group({ header: 'Liveliness', footer: 'Animations are off, so nothing moves. Turn Animations on under Sky / Background.' }, []));
        return;
      }
      if (!lvl && (sky.liveliness_all || 'classic') !== 'custom') {
        c.appendChild(K.group({ header: 'Liveliness', footer: 'The same for every occasion. Choose Custom for Liveliness on Sky / Background to set each its own.' }, [
          K.nav({ label: 'Liveliness', value: M.livelyPresetLabel(sky.liveliness_all || 'classic'), href: '#/house/sky', sk: 'sky.liveliness_all' })]));
        return;
      }
      var put = function (occMap, custMap) {
        if (lvl) {
          var o = {};
          if (occMap) o.sky_liveliness_occ = occMap;
          if (custMap) o.sky_liveliness_custom = custMap;
          return self.setB(lvl.path, o);
        }
        var h = {};
        if (occMap) h['sky.liveliness'] = occMap;
        if (custMap) h['sky.liveliness_custom'] = custMap;
        return self.setH(h);
      };
      var pick = function (p) {
        var all = Object.assign({}, lv), c2 = null;
        all[occ] = p;
        // Custom starts from the preset it was on, the first time
        if (p === 'custom' && !cust[occ]) {
          c2 = Object.assign({}, cust);
          c2[occ] = M.livelyFrom(cur === 'custom' ? 'classic' : cur, knobs);
        }
        put(all, c2);
      };
      var skp = lvl ? 'b:sky_liveliness_occ:' : 'lively:';
      c.appendChild(K.group({ header: 'Liveliness', footer: foot || 'How many of the little moving things, and how often the ones that cross come by.' },
        M.LIVELY_PRESETS.map(function (p) {
          return K.check({ label: p[1], sub: p[2], on: cur === p[0], fk: skp + occ + ':' + p[0], onClick: function () { pick(p[0]); } });
        })));
      if (cur !== 'custom') return;
      var mine = cust[occ] || M.livelyFrom('classic', knobs);
      var save = function (k, v) {
        var c2 = Object.assign({}, cust), o = Object.assign({}, mine);
        o[k] = v; c2[occ] = o;
        put(null, c2);
      };
      c.appendChild(K.group({ header: 'Custom', footer: 'Normal is as it has always been.' }, knobs.map(function (k) {
        var v = mine[k[0]] === undefined ? 2 : mine[k[0]];
        var sk = (lvl ? 'b:sky_liveliness_custom:' : 'sky.liveliness_custom:') + occ + ':' + k[0];
        if (k[2] === 'show') return K.toggle({ label: k[1], sk: sk, on: v > 0, onChange: function (x) { save(k[0], x ? 2 : 0); } });
        return K.slider({ label: k[1], sub: k[2] === 'often' ? 'How often' : 'How many', sk: sk, value: v, min: 0, max: 4, step: 1,
                          labels: k[2] === 'often' ? M.LIVELY_OFTEN : M.LIVELY_STEPS, onChange: function (x) { save(k[0], x); } });
      })));
    }
    h_backdrop(c) {
      var self = this, sky = this.data.settings.sky;
      var pick = function (id) {
        var changes = { 'sky.gradient': id };
        // Selecting Custom starts with a real palette immediately. Otherwise
        // its checked row would say Custom while the renderer fell back to live.
        if (id === 'custom' && !sky.gradient_custom) {
          var dusk = self.data.choices.sky_backdrops.filter(function (p) { return p.id === 'dusk'; })[0];
          changes['sky.gradient_custom'] = { day: dusk.day.slice(), night: dusk.night.slice() };
        }
        self.setH(changes);
      };
      c.appendChild(K.group({ header: 'The Sky', footer: 'The live sky’s colors on Home, the room pages, Weather and Calendar. Its weather, decorations and animations still show over it. Each screen can choose its own.' },
        this.backdropRows(sky.gradient || 'live', sky.gradient_custom, pick, 'hbackdrop:')));
      if (sky.gradient === 'custom') this.customBackdrop(c, sky.gradient_custom, 'sky.gradient_custom', function (v) {
        self.setH({ 'sky.gradient_custom': v });
      });
    }
    // A SCREEN'S PAGES, for their backgrounds: a page screen's own pages;
    // a whole screen's every page (and its custom pages)
    skyPageKeys(b) {
      var d = this.data, custom = {};
      (d.custom_pages || []).forEach(function (p) { custom[p.path] = p.title; });
      var only = b ? this.onlyOf(b) : null;
      var energyOn = this.energyOn(), powerOn = this.powerOn();
      if (energyOn) delete custom.energy;
      var keys;
      if (only && only.keys.length) keys = only.keys.slice();
      else {
        var dwOff = this.dwInSecurity(b);
        keys = (d.page_kinds || []).filter(function (k) { return (k !== 'energy' || energyOn) && (k !== 'power' || powerOn) && (k !== 'doors_windows' || !dwOff); });
        Object.keys(custom).forEach(function (k) {
          if (!b || (b.custom_pages || []).indexOf(k) >= 0 || (b.only_pages || []).indexOf(k) >= 0) keys.push(k);
        });
      }
      return { rows: M.skyPageRows(keys, custom), only: only };
    }
    // a page's background as it stands: this screen's, else All Screens',
    // else Automatic -- with where it comes from
    skyPageNow(row, b) {
      var all = this.data.settings.sky.pages || {}, mine = b ? b.sky_pages && b.sky_pages[row.key] : all[row.key];
      var mode = mine || all[row.key] || null;
      if (row.room) return { mode: mode, own: !!mine, live: mode === 'live' };
      // the sky's own settings (weather, decorations ...) reach a page only
      // while it shows the live sky: a color, its own or a backdrop, is still
      return { mode: mode, own: !!mine, live: mode ? mode === 'live' : !row.own && !row.custom };
    }
    s_sky(c, x, b) {
      var self = this, sky = this.data.settings.sky, rows = [];
      if (this.flatHere(b)) { this.flatSky(c, x, b, '#/screens/' + encodeURIComponent(x.path) + '/sky'); return; }
      // WHAT THESE SETTINGS REACH: the live sky only -- Home, the room pages
      // and any page set to Live Sky or a backdrop. A page screen whose pages
      // keep their own color shows none of it; say so, and the way to change it.
      var pk = this.skyPageKeys(b), base = '#/screens/' + encodeURIComponent(x.path);
      var bds = (this.data.choices || {}).sky_backdrops || [];
      // THE BACKGROUND FIRST (2026-10-13; was the Live Sky switch): Same as
      // All Screens, or this screen's own Live Sky, Color or Photo. A screen
      // whose Live Sky was turned off (b.sky false) reads as Color: Black --
      // what it showed -- and any choice here turns it back on.
      var skySw = (this.data.settings.look || {}).sky_switch;
      var pageScreen = !!(pk.only && pk.only.keys.length), legacyOff = b.sky === false;
      if (!pageScreen) {
        var ownMode = legacyOff ? 'color' : b.sky_background, hMode = sky.background || 'live', mode = ownMode || hMode;
        var bgRows = [K.seg({ label: 'Background', sub: ownMode ? 'Just This Screen' : 'Same as All Screens', sk: 'b:sky_background', value: mode,
          options: M.SKY_BACKGROUNDS, stack: !this.hasAttribute('wide'), onChange: function (v) {
            var ch = { sky_background: v, sky: true };
            if (legacyOff && v === 'color' && !b.sky_color) ch.sky_color = 'black';
            self.setB(x.path, ch);
          } })];
        if (ownMode) bgRows.push(K.button({ label: 'Reset to All Screens (' + M.BG_LABELS[hMode] + ')', sk: 'b:sky_background:reset',
          onClick: function () { self.setB(x.path, { sky_background: null, sky: true }); } }));
        var foot = [M.BG_SAYS[mode]];
        if (legacyOff) foot.push('This screen’s Live Sky was turned off, so it shows Black.');
        if (mode === 'live' && x.generated && skySw) foot.push('It also follows ' + this.name(skySw) + ' (All Screens → Sky / Background → Sky Switch).');
        if (!x.generated) foot.push('A screen written in YAML shows it wherever its YAML puts the sky.');
        c.appendChild(K.group({ footer: foot.join(' ') }, bgRows));
        if (mode === 'color') {
          this.colorGroup(c, { id: legacyOff ? (b.sky_color || 'black') : (b.sky_color || null), follow: ['Same as All Screens', sky.color || 'midnight'],
            custom: b.sky_custom || sky.gradient_custom, fk: 'bcolor:', scope: 'b:sky_custom:' + x.path,
            onPick: function (id) {
              var ch = { sky_color: id, sky: true };
              if (legacyOff) ch.sky_background = 'color';
              if (id === 'custom' && !b.sky_custom) ch.sky_custom = sky.gradient_custom || self.dusk();
              self.setB(x.path, ch);
            },
            onCustom: function (v) { self.setB(x.path, { sky_custom: v }); } });
          this.skyPagesGroup(c, x, b);
          this.skyResetGroup(c, x, b);
          return;
        }
        if (mode === 'photo') {
          this.photoGroup(c, { url: b.sky_photo || null, from: sky.photo || null, fromLabel: 'All Screens’ photo', fk: 'bphoto', sk: 'b:sky_photo',
            footer: 'Shown on Home, the room pages, and every page without a color of its own.',
            onSet: function (url) { var was = b.sky_photo; self.setB(x.path, { sky_photo: url, sky: true }).then(function (ok) { if (ok) self.photoForget(was); }); } });
          this.photoLookGroup(c, { look: b.sky_photo_look || sky.photo_look, own: !!b.sky_photo_look, sk: 'b:sky_photo_look', follow: 'All Screens',
            onSet: function (v) { self.setB(x.path, { sky_photo_look: v }); } });
          this.skyPagesGroup(c, x, b);
          this.skyResetGroup(c, x, b);
          return;
        }
        if (mode === 'landscapes') {
          this.landscapeGroup(c, { value: b.sky_landscape || null, house: sky.landscape || 'every:1440', fk: 'bland', sk: 'b:sky_landscape',
            href: base + '/sky/landscape', footer: 'Shown on Home, the room pages, and every page without a color of its own.',
            onSet: function (v) { self.setB(x.path, { sky_landscape: v, sky: true }); } });
          this.photoLookGroup(c, { look: b.sky_landscape_look || sky.landscape_look, own: !!b.sky_landscape_look, sk: 'b:sky_landscape_look', follow: 'All Screens',
            onSet: function (v) { self.setB(x.path, { sky_landscape_look: v }); } });
          this.skyPagesGroup(c, x, b);
          this.skyResetGroup(c, x, b);
          return;
        }
      }
      if (pageScreen) {
        var now = pk.rows.map(function (r) { return { r: r, n: self.skyPageNow(r, b) }; });
        var liveOnes = now.filter(function (o) { return o.n.live; });
        c.appendChild(K.group({ header: 'This Screen’s Pages', footer: liveOnes.length
            ? 'The Live Sky settings below reach ' + liveOnes.map(function (o) { return o.r.label; }).join(' and ') + '. ' +
              (liveOnes.length < now.length ? 'The rest keep their own background.' : '')
            : 'This screen has no Home page. Each page’s background — its own color, a Color, a Photo or the Live Sky — is chosen here.' },
          now.map(function (o) {
            return K.nav({ label: o.r.label + ' Background', value: o.n.mode ? M.skyModeLabel(o.n.mode, bds) : M.skyAutoLabel(o.r),
                           href: base + '/sky/page/' + encodeURIComponent(o.r.key), sk: 'b:sky_pages:' + o.r.key });
          })));
        // nothing here shows the live sky: none of its settings to show
        if (!liveOnes.length) { this.skyResetGroup(c, x, b); return; }
      }
      // Pause When Not in Focus only while anything moves here, Rain & Snow
      // only while there is weather (2026-10-10), as on All Screens' page
      var moving = b.sky_animations != null ? b.sky_animations : sky.animations !== false;
      var weathery = b.sky_weather != null ? b.sky_weather : sky.weather !== false;
      [['animations', 'Animations'], ['focus_pause', 'Pause When Not in Focus', moving],
       ['weather', 'Weather'], ['precipitation', 'Rain & Snow', weathery],
       ['decorations', 'Seasonal Decorations']].forEach(function (entry) {
        if (entry.length > 2 && !entry[2]) return;
        var key = 'sky_' + entry[0], own = b[key] != null, house = sky[entry[0]] !== false;
        rows.push(K.toggle({ label: entry[1], sk: 'b:' + key, on: own ? b[key] : house,
          sub: own ? 'Just This Screen' : 'Same as All Screens', onChange: function (v) { var o = {}; o[key] = v; self.setB(x.path, o); } }));
        if (own) rows.push(K.button({ label: 'Reset to All Screens (' + (house ? 'On' : 'Off') + ')', sk: 'b:' + key + ':reset',
          onClick: function () { var o = {}; o[key] = null; self.setB(x.path, o); } }));
      });
      // LIVELINESS, this screen's own (2026-10-09), as All Screens' is: one
      // preset for every occasion, or Custom -- each occasion its own (Each
      // Occasion). Only while anything moves here.
      var moves = b.sky_animations != null ? b.sky_animations : sky.animations !== false;
      if (moves) {
        var hAll = sky.liveliness_all || 'classic';
        rows.push(K.select({ label: 'Liveliness', sub: b.sky_liveliness ? 'Just This Screen' : 'Same as All Screens', sk: 'b:sky_liveliness',
          value: b.sky_liveliness || '',
          options: [['', 'Same as All Screens (' + M.livelyPresetLabel(hAll) + ')', M.livelyPresetLabel(hAll)]].concat(M.LIVELY_ALL),
          onChange: function (v) {
            var ch = { sky_liveliness: v || null };
            // Custom starts as the screen is now: All Screens' own occasions,
            // or the one preset on each
            if (v === 'custom' && !Object.keys(b.sky_liveliness_occ || {}).length) {
              var src = b.sky_liveliness && b.sky_liveliness !== 'custom' ? b.sky_liveliness : hAll;
              if (src === 'custom') {
                ch.sky_liveliness_occ = Object.assign({}, sky.liveliness || {});
                ch.sky_liveliness_custom = JSON.parse(JSON.stringify(sky.liveliness_custom || {}));
              } else {
                ch.sky_liveliness_occ = {};
                self.livelyOccs().forEach(function (id) { ch.sky_liveliness_occ[id] = src; });
              }
            }
            self.setB(x.path, ch);
          } }));
        if (b.sky_liveliness === 'custom') {
          rows.push(K.nav({ label: 'Each Occasion', sub: 'Every holiday, occasion, season and the Night Sky', sk: 'b:sky_liveliness_occ',
                            href: base + '/sky/lively', value: 'Custom' }));
        }
        // only where the screen's room can tell it is empty
        if (b.idle_room && M.roomSensors(this.client, b.idle_room).length) {
          rows.push(K.toggle({ label: 'Calm When Nobody\u2019s Around', sub: 'Half as much moving while ' + this.areaName(b.idle_room) +
              ' has been empty for 5 minutes', sk: 'b:sky_calm_empty', on: !!b.sky_calm_empty,
            onChange: function (v) { self.setB(x.path, { sky_calm_empty: v }); } }));
        }
      }
      // THE SKY'S LOOK, each as All Screens' tabs (2026-10-09): the shared
      // value until changed, then this screen's own and a way back
      var wideS = this.hasAttribute('wide');
      var segOwn = function (label, key, opts, houseVal) {
        var own = b[key] != null && b[key] !== '';
        rows.push(K.seg({ label: label, sub: own ? 'Just This Screen' : 'Same as All Screens', sk: 'b:' + key, stack: !wideS,
          value: own ? b[key] : houseVal, options: opts,
          onChange: function (v) { var o = {}; o[key] = v; self.setB(x.path, o); } }));
        if (own) rows.push(K.button({ label: 'Reset to All Screens (' + M.choiceLabel(opts, houseVal) + ')', sk: 'b:' + key + ':reset',
          onClick: function () { var o = {}; o[key] = null; self.setB(x.path, o); } }));
      };
      segOwn('Decoration Style', 'sky_decoration_style', [['old', 'Old Decorations'], ['new', 'New Decorations']], sky.decoration_style || 'old');
      segOwn('Moving Things', 'sky_moving', M.SKY_MOVING, sky.moving || 'behind');
      segOwn('Clouds', 'sky_cloud_style', M.CLOUD_STYLES, sky.cloud_style || 'classic');
      segOwn('Daytime Sky', 'sky_daytime', M.DAYTIME_SKIES, sky.daytime || 'natural');
      // a page screen's backdrop is its pages' (above): no second one here
      if (!(pk.only && pk.only.keys.length)) {
        rows.push(K.nav({ label: 'Sky Colors', sk: 'b:sky_gradient', href: '#/screens/' + encodeURIComponent(x.path) + '/sky/backdrop',
          sub: b.sky_gradient == null ? 'Same as All Screens' : 'Just This Screen',
          value: this.backdropLabel(b.sky_gradient == null ? sky.gradient : b.sky_gradient) }));
      }
      c.appendChild(K.group({ footer: 'Animations off also stops a running fan’s icon spinning, and hides falling rain and snow. ' +
          'Pause When Not in Focus: on a computer, everything holds still while another window is in front. ' +
          'Weather off leaves the sun, moon and stars; Rain & Snow off keeps the clouds and fog. Decorations use the dates and themes for All Screens. ' +
          'Liveliness: how many little things move, and how often — the same for every occasion, or Custom for each its own.' }, rows));
      // a whole screen's pages, under its sky (a page screen lists its own
      // at the top)
      if (!(pk.only && pk.only.keys.length)) this.skyPagesGroup(c, x, b);
    }
    s_backdrop(c, x, b) {
      var self = this, sky = this.data.settings.sky;
      var back = '#/screens/' + encodeURIComponent(x.path) + '/sky';
      // A PAGE SCREEN: its backdrop is its pages' -- each one's, here, and
      // nothing else (it has no Home or room page for a general backdrop)
      var pk = this.skyPageKeys(b);
      if (pk.only && pk.only.keys.length) { this.pageBackdrops(c, x, b, pk); return; }
      c.appendChild(K.group({ footer: 'Follows the backdrop and custom colors for All Screens as they change.' }, [
        K.check({ label: 'Same as All Screens', sub: 'Now ' + this.backdropLabel(sky.gradient), on: b.sky_gradient == null,
          fk: 'bbackdrop:house', onClick: function () { self.setB(x.path, M.backdropFollow(b)); self.back(back); } })]));
      var pick = function (id) {
        var changes = { sky_gradient: id };
        if (id === 'custom' && !b.sky_custom) {
          var dusk = self.data.choices.sky_backdrops.filter(function (p) { return p.id === 'dusk'; })[0];
          var start = sky.gradient_custom || dusk;
          changes.sky_custom = { day: start.day.slice(), night: start.night.slice() };
        }
        self.setB(x.path, changes);
        if (id !== 'custom') self.back(back);
      };
      c.appendChild(K.group({ header: 'The Sky — Just This Screen', footer: 'The live sky’s colors on Home, the room pages, Weather and Calendar, with its weather and decorations over it.' },
        this.backdropRows(b.sky_gradient, b.sky_custom || sky.gradient_custom, pick, 'bbackdrop:')));
      // A following screen has no selected own row, including Live.
      if (b.sky_gradient === 'custom') this.customBackdrop(c, b.sky_custom || sky.gradient_custom, 'b:sky_custom:' + x.path, function (v) {
        self.setB(x.path, { sky_custom: v });
      });
    }
    // A PAGE SCREEN'S BACKDROP: for each of its pages, Same as All Screens,
    // its own Page Color, the live sky or a fixed backdrop -- one list, the
    // page's name over it
    pageBackdrops(c, x, b, pk) {
      var self = this;
      pk.rows.forEach(function (r) { self.pagePicker(c, x, b, r, pk.rows.length === 1); });
      this.skyResetGroup(c, x, b);
    }
    // ONE PAGE'S BACKGROUND (2026-10-13: the Background's choices, page by
    // page): Automatic (All Screens) or Same as All Screens (a screen), its
    // own Page Color, the Live Sky, a still Color or a Photo -- for All
    // Screens (x, b null) or one screen. Stored as before ({page: 'own' |
    // 'live' | a color id | 'photo'}); a page's own photo in page_photos.
    // `alone`: the screen's only page (its background is the screen's).
    pagePicker(c, x, b, r, alone) {
      var self = this, sky = this.data.settings.sky, all = sky.pages || {};
      var bds = (this.data.choices || {}).sky_backdrops || [];
      var mine = b ? (b.sky_pages || {}) : all;
      var photos = b ? (b.sky_page_photos || {}) : (sky.page_photos || {});
      var custom = b ? (b.sky_custom || sky.gradient_custom) : sky.gradient_custom;
      var cur = mine[r.key] || '';
      var isColor = cur && cur !== 'own' && cur !== 'live' && cur !== 'photo' && cur !== 'landscapes';
      var put = function (ch) {
        if (b) { ch.sky = true; return self.setB(x.path, ch); }
        var hc = {};
        Object.keys(ch).forEach(function (k) { hc['sky.' + { sky_pages: 'pages', sky_page_photos: 'page_photos', sky_page_looks: 'page_looks', sky_custom: 'gradient_custom' }[k]] = ch[k]; });
        return self.setH(hc);
      };
      var pick = function (id) {
        var next = Object.assign({}, mine);
        if (id) next[r.key] = id; else delete next[r.key];
        var ch = { sky_pages: next };
        if (id === 'custom' && !(b ? b.sky_custom : sky.gradient_custom)) ch.sky_custom = sky.gradient_custom || self.dusk();
        put(ch);
      };
      // the color a page set to Color starts with: the screen's, else All Screens'
      var startColor = (b && b.sky_color) || sky.color || 'midnight';
      // a room's page follows Room Pages (All Screens' choice for the room
      // first, on a screen)
      var roomsNow = (b && (b.sky_pages || {}).rooms) || all.rooms;
      var first = b && all[r.key] ? ['Same as All Screens', 'Now ' + M.skyModeLabel(all[r.key], bds)]
                : r.room ? ['Same as Room Pages', 'Now ' + (roomsNow ? M.skyModeLabel(roomsNow, bds) : 'the screen’s Background')]
                : ['Automatic', r.own ? 'Its own color' : r.custom ? 'As written' : 'The screen’s Background'];
      var rows = [K.check({ label: first[0], sub: first[1], on: !cur, fk: 'pbd:' + r.key + ':auto', onClick: function () { pick(''); } })];
      if (r.own) rows.push(K.check({ label: 'Page Color', sub: 'The page’s own color', on: cur === 'own', fk: 'pbd:' + r.key + ':own',
                                     tile: ['mdi:palette-swatch', C.green], onClick: function () { pick('own'); } }));
      rows.push(K.check({ label: 'Live Sky', sub: 'The moving sky, with ' + (b ? 'this screen’s' : 'All Screens’') + ' weather and decorations', on: cur === 'live',
                          fk: 'pbd:' + r.key + ':live', tile: ['mdi:weather-sunset', C.blue], onClick: function () { pick('live'); } }));
      rows.push(K.check({ label: 'Color', sub: isColor ? M.skyModeLabel(cur, bds) : 'A still color', on: isColor, fk: 'pbd:' + r.key + ':color',
                          tile: ['mdi:palette', C.purple], onClick: function () { if (!isColor) pick(startColor); } }));
      rows.push(K.check({ label: 'Photo', sub: photos[r.key] ? 'Its own photo' : 'A photo, still', on: cur === 'photo', fk: 'pbd:' + r.key + ':photo',
                          tile: ['mdi:image', C.orange], onClick: function () { pick('photo'); } }));
      rows.push(K.check({ label: 'Landscapes', sub: PN() + '’s own photos, as ' + (b ? 'the screen' : 'All Screens') + ' has them', on: cur === 'landscapes',
                          fk: 'pbd:' + r.key + ':landscapes', tile: ['mdi:image-filter-hdr', C.teal], onClick: function () { pick('landscapes'); } }));
      c.appendChild(K.group({ header: alone === false ? r.label : null, footer: (alone ? r.label + ' is this screen’s only page, so its background is the screen’s. ' : '') +
        'Page Color, Color, Photo and Landscapes are still: no sun, moon, stars, weather or decorations.' }, rows));
      if (isColor) {
        this.colorGroup(c, { id: cur, custom: custom, fk: 'pbd:' + r.key + ':',
          onPick: function (id) { pick(id); },
          onCustom: function (v) { put({ sky_custom: v }); }, scope: b ? 'b:sky_custom:' + x.path : 'sky.gradient_custom' });
      }
      if (cur === 'photo') {
        var lvl = (r.room && photos.rooms) || (b ? (b.sky_photo || sky.photo) : sky.photo);
        this.photoGroup(c, { url: photos[r.key] || null, from: lvl || null,
          fromLabel: r.room && photos.rooms ? 'Room Pages’ photo' : b ? 'the screen’s photo' : 'All Screens’ photo',
          fk: 'pphoto:' + r.key, sk: b ? 'b:sky_page_photos' : 'sky.page_photos', header: 'Its Photo',
          footer: 'Without a photo of its own, the page shows ' + (r.room ? 'Room Pages’ photo, else ' : '') + (b ? 'the screen’s' : 'All Screens’') + ' Background photo.',
          onSet: function (url) {
            var was = photos[r.key], next = Object.assign({}, photos);
            if (url) next[r.key] = url; else delete next[r.key];
            put({ sky_page_photos: next }).then(function (ok) { if (ok) self.photoForget(was); });
          } });
        // ITS LOOK (2026-10-13): its own, else (a room) Room Pages', else the
        // screen's -- each a page apart, a photo of the room its own blur
        var looks = b ? (b.sky_page_looks || {}) : (sky.page_looks || {});
        var lvlLook = b ? (b.sky_photo_look || sky.photo_look) : sky.photo_look;
        var inLook = (r.room && looks.rooms) || lvlLook;
        this.photoLookGroup(c, { look: looks[r.key] || inLook, own: !!looks[r.key], sk: (b ? 'b:sky_page_looks:' : 'sky.page_looks:') + r.key,
          follow: r.room && looks.rooms ? 'Room Pages’ Look' : b ? 'the Screen’s Look' : 'All Screens’ Look',
          onSet: function (v) {
            var next = Object.assign({}, looks);
            if (v) next[r.key] = v; else delete next[r.key];
            put({ sky_page_looks: next });
          } });
      }
      // LANDSCAPES on a page: the screen's landscape (which one is the
      // Background's choice), with a Look of its own -- else the screen's
      // landscape look
      if (cur === 'landscapes') {
        var llooks = b ? (b.sky_page_looks || {}) : (sky.page_looks || {});
        var landLook = b ? (b.sky_landscape_look || sky.landscape_look) : sky.landscape_look;
        this.photoLookGroup(c, { look: llooks[r.key] || (r.room && llooks.rooms) || landLook, own: !!llooks[r.key],
          sk: (b ? 'b:sky_page_looks:' : 'sky.page_looks:') + r.key,
          follow: r.room && llooks.rooms ? 'Room Pages’ Look' : b ? 'the Screen’s Look' : 'All Screens’ Look',
          onSet: function (v) {
            var next = Object.assign({}, llooks);
            if (v) next[r.key] = v; else delete next[r.key];
            put({ sky_page_looks: next });
          } });
      }
      // ROOM PAGES: each room's own, a tap away (also in its Room Settings)
      if (r.key === 'rooms') {
        var base = b ? '#/screens/' + encodeURIComponent(x.path) + '/sky/page/' : '#/house/sky/page/';
        var rrows = this.areasAZ().map(function (aid) {
          var k = self.roomKey(aid);
          if (!k) return null;
          var n = self.skyPageNow({ key: k, room: true }, b);
          return K.nav({ label: self.areaName(aid), icon: ((self.client.areas || {})[aid] || {}).icon || 'mdi:texture-box',
                         value: n.own ? M.skyModeLabel(n.mode, bds) : 'Same as Room Pages', href: base + encodeURIComponent(k), sk: (b ? 'b:sky_pages:' : 'sky.pages:') + k });
        }).filter(Boolean);
        if (rrows.length) c.appendChild(K.group({ header: 'Each Room', footer: 'A room left alone is the same as Room Pages. A photo of the room itself, say, behind its page.' }, rrows));
      }
    }
    // THE PAGES, under Sky / Background: each page and its background, a
    // tap away -- where people look for it, not inside the sky's Backdrop
    skyPagesGroup(c, x, b, header) {
      var self = this, bds = (this.data.choices || {}).sky_backdrops || [];
      var pk = this.skyPageKeys(b);
      var base = b ? '#/screens/' + encodeURIComponent(x.path) + '/sky/page/' : '#/house/sky/page/';
      // ALL SCREENS': a page under Pages has its background there (its Look),
      // since 2026-10-16 -- here are the rest: Room Pages, custom pages
      var rows = b ? pk.rows : pk.rows.filter(function (r) { return !M.pageOf(r.key); });
      if (!rows.length) return;
      c.appendChild(K.group({ header: header || 'Pages', sk: b ? 'b:sky_pages' : 'sky.pages', footer: 'Each page’s background: Automatic (its own color, or the Background above), the Live Sky, a still Color, or a Photo.' +
          (b ? ' A page left alone follows All Screens.' : ' Each screen can choose its own. Climate, Lights and the other pages have theirs under Pages.') },
        rows.map(function (r) {
          var n = self.skyPageNow(r, b);
          return K.nav({ label: r.label, sub: r.custom ? 'Custom page' : null, value: n.mode ? M.skyModeLabel(n.mode, bds) : M.skyAutoLabel(r),
                         href: base + encodeURIComponent(r.key), sk: (b ? 'b:sky_pages:' : 'sky.pages:') + r.key });
        })));
    }
    // FLAT'S BACKGROUNDS (2026-10-16; settings.py FLAT_BACKGROUNDS). Flat
    // draws no live sky, so while a screen wears it, Sky / Background is
    // Flat's own page: a Color (Automatic, a tone that follows Light and
    // Dark, or your own), a Photo or Landscapes, how far a photo fades, and
    // each page's. The Glass looks' Sky / Background is kept for when Flat
    // is left. b null: All Screens'.
    flatHere(b) {
      var look = this.data.settings.look || {};
      return b ? M.glassOf(b, look).effective === 'flat' : look.flat === true;
    }
    flatTheme(b) {
      var look = this.data.settings.look || {};
      var t = b && (b.flat_theme === 'light' || b.flat_theme === 'dark') ? b.flat_theme : look.flat_theme;
      return t === 'light' ? 'light' : 'dark';
    }
    flatColors() { return (this.data.choices || {}).flat_colors || []; }
    // a color's name in this theme (Black is Pebble in Light)
    flatColorLabel(id, theme) {
      if (!id || id === 'auto') return 'Automatic';
      if (/^#/.test(id)) return 'Your Own Color';
      var p = this.flatColors().filter(function (x) { return x.id === id; })[0];
      return p ? (theme === 'light' && p.light_label) || p.label : id;
    }
    flatModeLabel(mode, theme) {
      return mode === 'photo' ? 'Photo' : mode === 'landscapes' ? 'Landscapes' : this.flatColorLabel(mode, theme);
    }
    // a page's Flat background now: {mode (its own, else All Screens'), own}
    flatPageNow(row, b) {
      var all = this.data.settings.sky.flat_pages || {}, mine = b ? (b.sky_flat_pages || {})[row.key] : all[row.key];
      return { mode: mine || all[row.key] || null, own: !!mine };
    }
    // (a page left alone says Automatic, whatever Automatic is for it)
    flatAutoLabel(row) { return 'Automatic'; }
    // a page's background in a word, whichever look the screen wears
    skyPageLabel(row, b) {
      if (this.flatHere(b)) { var f = this.flatPageNow(row, b); return f.mode ? this.flatModeLabel(f.mode, this.flatTheme(b)) : this.flatAutoLabel(row); }
      var n = this.skyPageNow(row, b), bds = (this.data.choices || {}).sky_backdrops || [];
      return n.mode ? M.skyModeLabel(n.mode, bds) : M.skyAutoLabel(row);
    }
    // the screen's (or All Screens') Flat background in a few words
    flatSummary(b) {
      var sky = this.data.settings.sky;
      var bg = (b && b.sky_flat_background) || sky.flat_background || 'color';
      return bg === 'color' ? this.flatColorLabel((b && b.sky_flat_color) || sky.flat_color || 'auto', this.flatTheme(b)) : M.BG_LABELS[bg];
    }
    // the store for Flat's keys: a screen's sky_flat_* / sky_page_photos, or
    // All Screens' sky.flat_* / sky.page_photos
    flatPut(x, b) {
      var self = this;
      return function (ch) {
        if (b) return self.setB(x.path, ch);
        var o = {};
        Object.keys(ch).forEach(function (k) { o['sky.' + k.replace(/^sky_/, '')] = ch[k]; });
        return self.setH(o);
      };
    }
    // THE COLORS: the theme's tone of each, then your own. o = { id (own,
    // or null following), follow ([label, id] or null), auto (offer
    // Automatic), theme, onPick(id | null), fk }
    flatColorGroup(c, o) {
      var self = this, rows = [], light = o.theme === 'light';
      var tone = function (id) {
        if (/^#/.test(id || '')) return id;
        var p = self.flatColors().filter(function (x) { return x.id === id; })[0] || self.flatColors()[0];
        return p ? p[light ? 'light' : 'dark'] : (light ? '#EEECE6' : '#17181A');
      };
      if (o.follow) rows.push(K.check({ label: o.follow[0], sub: 'Now ' + this.flatColorLabel(o.follow[1], o.theme), on: !o.id, fk: o.fk + 'follow',
                                        onClick: function () { o.onPick(null); } }));
      if (o.auto) rows.push(K.check({ label: 'Automatic', sub: 'Stone here; Climate, Lights, Security, Calendar and Weather each in a tone of their own',
                                      on: o.id === 'auto', fk: o.fk + 'auto', tile: ['mdi:auto-fix', tone('stone')], onClick: function () { o.onPick('auto'); } }));
      this.flatColors().forEach(function (p) {
        rows.push(K.check({ label: (light && p.light_label) || p.label, tile: ['', p[light ? 'light' : 'dark']], on: o.id === p.id, fk: o.fk + p.id,
                            onClick: function () { o.onPick(p.id); } }));
      });
      var own = /^#/.test(o.id || '');
      var row = K.text({ label: 'Your Own Color', sub: own ? o.id : 'Pick any color. It stays the same in Light and Dark.', type: 'color', fk: o.fk + 'custom',
                         value: own ? o.id : tone(o.id || 'stone'), onCommit: function (t) { if (/^#[0-9a-f]{6}$/i.test(t)) o.onPick(t.toUpperCase()); } });
      var inp = row.querySelector('input');
      if (inp) {
        inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
        inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) o.onPick(inp.value.toUpperCase()); });
      }
      if (own) row.classList.add('on');
      rows.push(row);
      c.appendChild(K.group({ header: o.header || 'Color', footer: 'Shown in their ' + (light ? 'Light' : 'Dark') + ' tones: each color has a Light and a Dark tone, and follows the Theme under Appearance. Solid, with nothing drawn on it.' }, rows));
    }
    // One editor and resolver for house, screen, page, and room image looks.
    // Opening writes nothing; patches preserve unrelated fields in the store.
    flatImageGroup(c, x, b, key) {
      var self = this, I = window.hkFlatImage, sky = this.data.settings.sky || {};
      if (!I) return 'legacy';
      var keys = key ? (/^room-/.test(key) ? [key, 'rooms'] : [key]) : [];
      var resolved = I.resolve(sky, b, keys), look = resolved.value;
      var field = key ? 'sky_flat_page_image_looks.' + key : 'sky_flat_image_look';
      var path = b ? field : 'sky.' + field.replace(/^sky_/, '');
      var own = key ? ((b ? b.sky_flat_page_image_looks : sky.flat_page_image_looks) || {})[key] || {}
                    : (b ? b.sky_flat_image_look : sky.flat_image_look) || {};
      var patchPath = key ? path : path + '.patch';
      var patch = function (value) { var ch = {}; ch[patchPath] = value; return b ? self.setB(x.path, ch) : self.setH(ch); };
      var source = function (name) { return M.flatSourceLabel(resolved.from[name]) || 'Built-in Default'; };
      var labels = { legacy: 'Previous Look', original: 'Original', soft: 'Soft', balanced: 'Balanced', rich: 'Rich', washed: 'Washed', custom: 'Custom' };
      var notes = { original: 'Keep the photograph’s colors.', soft: 'Quiet color and gentle shadows.', balanced: 'Clear scenery with a moderate tint.', rich: 'Deeper shadows and richer color.', washed: 'A faint backdrop behind the cards.' };
      var active = I.preset(look);
      var legacyTint = (b && b.sky_flat_tint) || sky.flat_tint || 'none';
      var choose = function (name) {
        var v = name === 'original' || name === 'legacy' ? { mode: name } : Object.assign({}, I.presets[name]);
        if (resolved.from.color.scope === 'default' && /^#/.test(legacyTint)) v.color = legacyTint;
        patch(v);
      };
      var rows = [K.select({ label: 'Image Look', sub: labels[active] + ' · ' + source('mode'), sk: path, fk: 'fi:look', value: active,
        options: Object.keys(labels).map(function (name) { return [name, labels[name]]; }),
        onChange: function (name) { if (name !== 'custom') choose(name); } })];
      if (Object.keys(own).length) rows.push(K.button({ label: key || b ? 'Use Inherited Image Settings' : 'Reset Image Settings', fk: 'fi:reset', onClick: function () { patch(null); } }));
      c.appendChild(this.withError(K.group({ header: 'Image Look', footer: look.mode === 'legacy'
        ? 'Your previous appearance is kept. Choose a look below to use the new tint controls.'
        : 'Choose a starting point, then Adjust if you want. A look keeps your image and color choice. Page choices take priority over general screen settings.' }, rows), patchPath));

      var palette = M.flatColorsOf(this.data.settings.look || {}, b, keys);
      var seed = M.flatColorHex(palette.accent.value);
      var menuAccent = b && b.menu_custom ? b.accent : (this.data.settings.menu || {}).accent;
      var legacyAccent = menuAccent === 'auto' ? M.pageAccentOf(key || 'home', (this.data.settings.look || {}).page_accents).a.hex : M.accentOf(menuAccent).hex;
      var color = look.color === 'accent' ? seed || legacyAccent : look.color;
      var theme = this.flatTheme(b), list = this.landscapes() || [];
      var landscape = M.landscapeFile((b && b.sky_landscape) || sky.landscape || 'every:1440', list);
      var photos = b && b.sky_page_photos || {}, housePhotos = sky.page_photos || {};
      var pageMode = null, photo = null;
      keys.some(function (k) { pageMode = (b && b.sky_flat_pages || {})[k] || (sky.flat_pages || {})[k]; return !!pageMode; });
      keys.some(function (k) { photo = photos[k] || housePhotos[k]; return !!photo; });
      var mode = pageMode && pageMode !== 'auto' ? pageMode : key && FLAT_OWN[key] ? 'color' : (b && b.sky_flat_background) || sky.flat_background || 'color';
      var src = mode === 'photo' ? photo || (b && b.sky_photo) || sky.photo : null;
      var example = mode !== 'landscapes' && !src;
      if (!src && landscape) src = '/hk/landscapes/' + landscape;
      var image = new Image(), paints = [];
      function addPreview(canvas, style, overlay) {
        paints.push(function () {
          if (!canvas.isConnected) return;
          try {
            I.paint(canvas, image, style, style.color === 'accent' ? seed || legacyAccent : style.color, canvas.className === 'flat-image-thumb' ? 180 : 640);
            if (overlay) overlay.style.background = I.fade(style.fade, theme);
            canvas.style.opacity = '1';
          } catch (e) { canvas.style.opacity = '0'; }
        });
      }
      var presetRows = Object.keys(notes).map(function (name) {
        var button = K.check({ label: labels[name], sub: notes[name], on: active === name, fk: 'fi:' + name, onClick: function () { choose(name); } });
        var box = h('span', { class: 'flat-image-mini', 'aria-hidden': 'true' });
        var cv = h('canvas', { class: 'flat-image-thumb' }), wash = h('span', { class: 'flat-image-wash' });
        box.appendChild(cv); box.appendChild(wash); button.insertBefore(box, button.firstChild);
        var style = Object.assign({}, look, name === 'original' ? { mode: 'original' } : I.presets[name]);
        addPreview(cv, style, wash); return button;
      });
      c.appendChild(K.group({ header: 'Starting Points' }, presetRows));
      if (look.mode !== 'legacy') {
        var preview = h('div', { class: 'cell photoprev' }), frame = h('div', { class: 'flat-image-preview' });
        frame.setAttribute('data-source', src || '');
        var canvas = h('canvas', { 'aria-label': 'Image look preview', role: 'img' }), overlay = h('span', { class: 'flat-image-wash' });
        frame.appendChild(canvas); frame.appendChild(overlay); preview.appendChild(frame);
        preview.appendChild(h('small', { text: src ? (example ? 'Sample landscape · choose Photo or Landscapes to use this look.' : 'Preview · ' + (key || (x && x.title) || 'All Screens')) : 'Choose a photo or landscape to preview the look.' }));
        var previewLook = Object.assign({}, look); addPreview(canvas, previewLook, overlay);
        var colorRows = [preview];
        if (look.mode === 'tinted') {
          colorRows.push(K.seg({ label: 'Color', sub: source('color'), value: look.color === 'accent' ? 'accent' : 'own', sk: path + ':color',
            options: [['accent', 'Match Accent'], ['own', 'Your Own Color']], onChange: function (v) { patch({ color: v === 'accent' ? 'accent' : color }); } }));
          if (look.color !== 'accent') {
            var cr = K.text({ label: 'Tint Color', type: 'color', fk: 'fi:color', value: look.color, onCommit: function (v) { patch({ color: v }); } });
            var input = cr.querySelector('input'); input.addEventListener('change', function () { patch({ color: input.value }); }); colorRows.push(cr);
          }
          if (own.color != null) colorRows.push(K.button({ label: 'Use Inherited Color', onClick: function () { patch({ color: null }); } }));
        }
        c.appendChild(K.group({ footer: 'Match Accent follows this page’s effective accent. Your Own Color stays independent.' }, colorRows));
        var adjustId = path + ':' + (x && x.path || 'house');
        this._flatImageAdjust = this._flatImageAdjust || {};
        var details = h('details', { class: 'flat-image-adjust' }); details.open = !!this._flatImageAdjust[adjustId];
        details.appendChild(h('summary', { class: 'cell', text: 'Adjust' }));
        details.addEventListener('toggle', function () { self._flatImageAdjust[adjustId] = details.open; });
        var sliders = [], fields = look.mode === 'tinted' ? ['strength', 'depth', 'brightness', 'fade'] : ['brightness', 'fade'];
        var help = { strength: 'Grayscale to full color', depth: 'Soft shadows to richer neighboring hues', brightness: 'Lighten or darken the image’s midtones', fade: 'Soften the image behind the cards' };
        fields.forEach(function (name) {
          var title = name.charAt(0).toUpperCase() + name.slice(1), says;
          if (name === 'brightness') { says = []; for (var n = -50; n <= 50; n++) says.push(n > 0 ? '+' + n : String(n)); }
          var row = K.slider({ label: title, sub: help[name] + ' · ' + source(name), sk: path + ':' + name, value: look[name], min: name === 'brightness' ? -50 : 0,
            max: name === 'brightness' ? 50 : 100, step: 5, labels: says, unit: name === 'brightness' ? '' : '%',
            onChange: function (v) { self._flatImageAdjust[adjustId] = details.open; var change = {}; change[name] = v; patch(change); } });
          if (says) { var out = row.querySelector('.val'); if (out) out.textContent = look[name] > 0 ? '+' + look[name] : String(look[name]); }
          row.querySelector('input').addEventListener('input', function (e) {
            previewLook[name] = +e.target.value; if (image.complete && image.naturalWidth) paints[paints.length - 1]();
          });
          sliders.push(row);
          if (own[name] != null) sliders.push(K.button({ label: 'Use Inherited ' + title, onClick: function () { var v = {}; v[name] = null; patch(v); } }));
        });
        details.appendChild(K.group({ footer: 'Strength, Depth, Brightness, and Fade are independent. Adjusting a preset makes it Custom.' }, sliders)); c.appendChild(details);
      }
      image.onload = function () { paints.forEach(function (paint) { paint(); }); };
      image.onerror = function () { if (preview) { var note = preview.querySelector('small'); if (note) note.textContent = 'The image could not be loaded. Your look is kept.'; } };
      if (src) image.src = src;
      return look.mode;
    }
    // THE FADE over a photo: the theme's ground washed over it, so the
    // cards stay easy to read. o = { value, house (a screen's: All Screens'),
    // own, onSet(v | null), sk }
    flatFadeGroup(c, o) {
      var self = this;
      var rows = [K.slider({ label: 'Fade', sub: o.house === undefined ? null : (o.own ? 'Just This Screen' : 'Same as All Screens'), sk: o.sk,
                             value: o.value, min: 0, max: 100, step: 5, unit: '%', onChange: function (v) { o.onSet(v); } })];
      if (o.own) rows.push(K.button({ label: 'Reset to All Screens (' + o.house + '%)', sk: o.sk + ':reset', onClick: function () { o.onSet(null); } }));
      // TINT (2026-10-17, the user): the color the fade leans to -- none
      // (the theme's own), the page's accent, or one of your own
      var t = o.tint, tv = t.value || 'none', own = /^#/.test(tv);
      rows.push(K.seg({ label: 'Tint', sub: t.house === undefined ? null : (t.own ? 'Just This Screen' : 'Same as All Screens'), sk: t.sk,
        value: own ? 'own' : tv, options: [['none', 'None'], ['accent', 'Match Accent'], ['own', 'Your Own']], stack: !this.hasAttribute('wide'),
        onChange: function (v) { t.onSet(v === 'own' ? (own ? tv : '#7e9b83') : v); } }));
      if (own) {
        var row = K.text({ label: 'Tint Color', sub: tv.toUpperCase(), type: 'color', fk: t.sk + ':color', value: tv,
                           onCommit: function (x) { if (/^#[0-9a-f]{6}$/i.test(x)) t.onSet(x.toLowerCase()); } });
        var inp = row.querySelector('input');
        if (inp) {
          inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
          inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) t.onSet(inp.value.toLowerCase()); });
        }
        rows.push(row);
      }
      if (t.own) rows.push(K.button({ label: 'Reset Tint to All Screens (' + M.flatTintLabel(t.house) + ')', sk: t.sk + ':reset', onClick: function () { t.onSet(null); } }));
      // ...and how strong (2026-10-17, the user: a light one, or a strong one)
      if (tv !== 'none') {
        var ta = o.tintAmount;
        rows.push(K.slider({ label: 'Tint Strength', sub: ta.house === undefined ? null : (ta.own ? 'Just This Screen' : 'Same as All Screens'), sk: ta.sk,
                             value: ta.value, min: 0, max: 100, step: 5, unit: '%', onChange: function (v) { ta.onSet(v); } }));
        if (ta.own) rows.push(K.button({ label: 'Reset Strength to All Screens (' + ta.house + '%)', sk: ta.sk + ':reset', onClick: function () { ta.onSet(null); } }));
        // ...and how bright: stored 0-100, 50 the photo as it is, said -50..+50
        var tb = o.tintLight, says = [];
        for (var n = 0; n <= 100; n++) says.push(n === 50 ? '0' : (n > 50 ? '+' : '−') + Math.abs(n - 50));
        rows.push(K.slider({ label: 'Tint Brightness', sub: tb.house === undefined ? null : (tb.own ? 'Just This Screen' : 'Same as All Screens'), sk: tb.sk,
                             value: tb.value, min: 0, max: 100, step: 5, labels: says, onChange: function (v) { tb.onSet(v); } }));
        if (tb.own) rows.push(K.button({ label: 'Reset Brightness to All Screens (' + says[tb.house] + ')', sk: tb.sk + ':reset', onClick: function () { tb.onSet(null); } }));
      }
      void self;
      c.appendChild(this.withError(K.group({ footer: 'How far the background fades behind the cards: Light washes it toward limestone, Dark toward black. 0% shows the photo as taken. ' +
        'Tint turns the photo to one color, keeping its own light and dark: the page’s accent (its Flat Accent Color, else its own Accent Color), or one of your own. Strength is how far; Brightness lightens or darkens it.' }, rows), o.sk));
    }
    flatSky(c, x, b, base) {
      var self = this, sky = this.data.settings.sky, theme = this.flatTheme(b), put = this.flatPut(x, b);
      var hMode = sky.flat_background || 'color', own = b ? b.sky_flat_background : null, mode = own || hMode;
      var bgRows = [K.seg({ label: 'Background', sub: b ? (own ? 'Just This Screen' : 'Same as All Screens') : null, sk: b ? 'b:sky_flat_background' : 'sky.flat_background',
        value: mode, options: [['color', 'Color'], ['photo', 'Photo'], ['landscapes', 'Landscapes']], stack: !this.hasAttribute('wide'),
        onChange: function (v) { put({ sky_flat_background: v }); } })];
      if (own) bgRows.push(K.button({ label: 'Reset to All Screens (' + M.BG_LABELS[hMode] + ')', sk: 'b:sky_flat_background:reset',
                                      onClick: function () { put({ sky_flat_background: null }); } }));
      var says = { color: 'A solid color behind the cards.', photo: 'A photo of your own, still, faded behind the cards.',
                   landscapes: 'One of ' + PN() + '’s landscape photos, still, faded behind the cards.' };
      c.appendChild(K.group({ footer: says[mode] + ' Flat shows no Live Sky: its sun, weather and decorations come back with the other looks, as you left them. ' +
        (b ? 'Each page can choose its own below.' : 'Each screen, and each page, can choose its own.') }, bgRows));
      if (mode === 'color') {
        this.flatColorGroup(c, { id: b ? (b.sky_flat_color || null) : (sky.flat_color || 'auto'), follow: b ? ['Same as All Screens', sky.flat_color || 'auto'] : null,
          auto: true, theme: theme, fk: b ? 'bflat:' : 'hflat:', onPick: function (id) { put({ sky_flat_color: id }); } });
      }
      if (mode === 'photo') {
        this.photoGroup(c, b ? { url: b.sky_photo || null, from: sky.photo || null, fromLabel: 'All Screens’ photo', fk: 'bphoto', sk: 'b:sky_photo',
                                 footer: 'The same photo the other looks use.',
                                 onSet: function (url) { var was = b.sky_photo; self.setB(x.path, { sky_photo: url }).then(function (ok) { if (ok) self.photoForget(was); }); } }
                             : { url: sky.photo || null, fk: 'hphoto', sk: 'sky.photo', footer: 'The same photo the other looks use.',
                                 onSet: function (url) { var was = sky.photo; self.setH({ 'sky.photo': url }).then(function (ok) { if (ok) self.photoForget(was); }); } });
      }
      if (mode === 'landscapes') {
        this.landscapeGroup(c, b ? { value: b.sky_landscape || null, house: sky.landscape || 'every:1440', fk: 'bland', sk: 'b:sky_landscape', href: base + '/landscape',
                                     onSet: function (v) { self.setB(x.path, { sky_landscape: v }); } }
                                 : { value: sky.landscape || 'every:1440', fk: 'hland', sk: 'sky.landscape', href: '#/house/sky/landscape',
                                     onSet: function (v) { self.setH({ 'sky.landscape': v }); } });
      }
      // the fade reaches every photo here -- a page's own too -- so it shows
      // wherever a photo can be
      var hFade = sky.flat_fade == null ? 50 : sky.flat_fade, fOwn = !!b && b.sky_flat_fade != null;
      var hTint = sky.flat_tint || 'none', tOwn = !!b && b.sky_flat_tint != null;
      var hAmt = sky.flat_tint_amount == null ? 60 : sky.flat_tint_amount, aOwn = !!b && b.sky_flat_tint_amount != null;
      var hLight = sky.flat_tint_light == null ? 50 : sky.flat_tint_light, lOwn = !!b && b.sky_flat_tint_light != null;
      if (this.flatImageGroup(c, x, b, null) === 'legacy') this.flatFadeGroup(c, { value: fOwn ? b.sky_flat_fade : hFade, house: b ? hFade : undefined, own: fOwn, sk: b ? 'b:sky_flat_fade' : 'sky.flat_fade',
                              onSet: function (v) { put({ sky_flat_fade: v }); },
                              tint: { value: tOwn ? b.sky_flat_tint : hTint, house: b ? hTint : undefined, own: tOwn, sk: b ? 'b:sky_flat_tint' : 'sky.flat_tint',
                                      onSet: function (v) { put({ sky_flat_tint: v }); } },
                              tintAmount: { value: aOwn ? b.sky_flat_tint_amount : hAmt, house: b ? hAmt : undefined, own: aOwn,
                                            sk: b ? 'b:sky_flat_tint_amount' : 'sky.flat_tint_amount', onSet: function (v) { put({ sky_flat_tint_amount: v }); } },
                              tintLight: { value: lOwn ? b.sky_flat_tint_light : hLight, house: b ? hLight : undefined, own: lOwn,
                                           sk: b ? 'b:sky_flat_tint_light' : 'sky.flat_tint_light', onSet: function (v) { put({ sky_flat_tint_light: v }); } } });
      this.flatPagesGroup(c, x, b, base);
      this.skyResetGroup(c, x, b);
    }
    // THE PAGES' Flat backgrounds, a tap away
    flatPagesGroup(c, x, b, base) {
      var self = this, rows = this.skyPageKeys(b).rows, theme = this.flatTheme(b);
      if (!rows.length) return;
      c.appendChild(K.group({ header: 'Pages', sk: b ? 'b:sky_flat_pages' : 'sky.flat_pages',
        footer: 'Each page’s background: Automatic (its own tone, or the Background above), a Color, a Photo or Landscapes.' + (b ? ' A page left alone follows All Screens.' : '') },
        rows.map(function (r) {
          var n = self.flatPageNow(r, b);
          return K.nav({ label: r.label, sub: r.custom ? 'Custom page' : null, value: n.mode ? self.flatModeLabel(n.mode, theme) : self.flatAutoLabel(r),
                         href: base + '/page/' + encodeURIComponent(r.key), sk: (b ? 'b:sky_flat_pages:' : 'sky.flat_pages:') + r.key });
        })));
    }
    // ONE PAGE'S Flat background: Same as All Screens / Room Pages, Automatic,
    // a Color, a Photo or Landscapes
    flatPagePicker(c, x, b, r, base) {
      var self = this, sky = this.data.settings.sky, all = sky.flat_pages || {}, theme = this.flatTheme(b), put = this.flatPut(x, b);
      var mine = b ? (b.sky_flat_pages || {}) : all, photos = b ? (b.sky_page_photos || {}) : (sky.page_photos || {});
      var cur = mine[r.key] || '';
      var isColor = !!cur && cur !== 'auto' && cur !== 'photo' && cur !== 'landscapes';
      var pick = function (v) {
        var next = Object.assign({}, mine);
        if (v) next[r.key] = v; else delete next[r.key];
        put({ sky_flat_pages: next });
      };
      var roomsNow = (b && (b.sky_flat_pages || {}).rooms) || all.rooms;
      var follow = b && all[r.key] ? ['Same as All Screens', 'Now ' + this.flatModeLabel(all[r.key], theme)]
                 : r.room ? ['Same as Room Pages', 'Now ' + (roomsNow ? this.flatModeLabel(roomsNow, theme) : 'the screen’s Background')] : null;
      var autoSays = FLAT_OWN[r.key] ? (M.PAGE_ACCENTS[r.key] ? 'A light or dark shade of its Accent Color (' + M.pageAccentOf(r.key, this.hs('look.page_accents')).a.name + ')' : 'Its own tone, in Light and Dark')
                                     : 'The screen’s Background (' + this.flatSummary(b) + ')';
      var rows = [];
      if (follow) rows.push(K.check({ label: follow[0], sub: follow[1], on: !cur, fk: 'fpbd:' + r.key + ':follow', onClick: function () { pick(''); } }));
      rows.push(K.check({ label: 'Automatic', sub: autoSays, on: follow ? cur === 'auto' : (!cur || cur === 'auto'), fk: 'fpbd:' + r.key + ':auto',
                          tile: ['mdi:auto-fix', C.green], onClick: function () { pick(follow ? 'auto' : ''); } }));
      rows.push(K.check({ label: 'Color', sub: isColor ? this.flatColorLabel(cur, theme) : 'A solid color', on: isColor, fk: 'fpbd:' + r.key + ':color',
                          tile: ['mdi:palette', C.purple], onClick: function () { if (!isColor) pick((b && b.sky_flat_color && b.sky_flat_color !== 'auto' && b.sky_flat_color) || (sky.flat_color !== 'auto' && sky.flat_color) || 'stone'); } }));
      rows.push(K.check({ label: 'Photo', sub: photos[r.key] ? 'Its own photo' : 'A photo, still', on: cur === 'photo', fk: 'fpbd:' + r.key + ':photo',
                          tile: ['mdi:image', C.orange], onClick: function () { pick('photo'); } }));
      rows.push(K.check({ label: 'Landscapes', sub: PN() + '’s own photos, as ' + (b ? 'the screen' : 'All Screens') + ' has them', on: cur === 'landscapes',
                          fk: 'fpbd:' + r.key + ':landscapes', tile: ['mdi:image-filter-hdr', C.teal], onClick: function () { pick('landscapes'); } }));
      c.appendChild(K.group({ footer: 'While Flat is on. A photo here fades as ' + (b ? 'the screen’s' : 'All Screens’') + ' Fade says.' }, rows));
      // ITS FLAT COLORS, beside its background (the same page key)
      var fps = this.flatScope(b ? 'screen-page' : 'house-page', x, b, r.key);
      c.appendChild(K.group({ footer: 'Its Accent Color shades an Automatic background here.' },
        [this.flatColorsNav(fps, { inherited: b ? 'Same as This Screen' : 'Same as All Screens' })]));
      if (isColor) this.flatColorGroup(c, { id: cur, theme: theme, fk: 'fpbd:' + r.key + ':', onPick: function (id) { pick(id); } });
      if (cur === 'photo') {
        var lvl = (r.room && photos.rooms) || (b ? (b.sky_photo || sky.photo) : sky.photo);
        this.photoGroup(c, { url: photos[r.key] || null, from: lvl || null,
          fromLabel: r.room && photos.rooms ? 'Room Pages’ photo' : b ? 'the screen’s photo' : 'All Screens’ photo',
          fk: 'pphoto:' + r.key, sk: b ? 'b:sky_page_photos' : 'sky.page_photos', header: 'Its Photo',
          footer: 'The same photo the other looks use for this page.',
          onSet: function (url) {
            var was = photos[r.key], next = Object.assign({}, photos);
            if (url) next[r.key] = url; else delete next[r.key];
            put({ sky_page_photos: next }).then(function (ok) { if (ok) self.photoForget(was); });
          } });
      }
      this.flatImageGroup(c, x, b, r.key);
      if (r.key === 'rooms') {
        var rrows = this.areasAZ().map(function (aid) {
          var k = self.roomKey(aid);
          if (!k) return null;
          var n = self.flatPageNow({ key: k, room: true }, b);
          return K.nav({ label: self.areaName(aid), icon: ((self.client.areas || {})[aid] || {}).icon || 'mdi:texture-box',
                         value: n.own ? self.flatModeLabel(n.mode, theme) : 'Same as Room Pages', href: base + '/page/' + encodeURIComponent(k),
                         sk: (b ? 'b:sky_flat_pages:' : 'sky.flat_pages:') + k });
        }).filter(Boolean);
        if (rrows.length) c.appendChild(K.group({ header: 'Each Room', footer: 'A room left alone is the same as Room Pages.' }, rrows));
      }
    }
    // FLAT COLORS (2026-10-17; hk_house/docs/PLAN-2026-10-17-flat-appearance-colors.md):
    // Flat's Accent Color and Off Pill Tint, one editor at every scope --
    // All Screens, a screen, and a page or room on either. A scope:
    // {kind: 'house' | 'screen' | 'house-page' | 'screen-page', x, b, key}.
    // Opening any of it writes nothing; a field left alone is inherited,
    // Automatic stops there.
    flatAnywhere() {
      var look = this.data.settings.look || {}, boards = this.data.boards || {};
      return look.flat === true || Object.keys(boards).some(function (p) { return M.glassOf(boards[p], look).effective === 'flat'; });
    }
    flatScope(kind, x, b, key) {
      var self = this, look = this.data.settings.look || {};
      var screen = kind === 'screen' || kind === 'screen-page', page = kind === 'house-page' || kind === 'screen-page';
      var sb = screen ? b : null, row = page ? this.skyRow(key, sb) : null;
      var keys = page ? (row && row.room ? [key, 'rooms'] : [key]) : [];
      var base = screen ? '#/screens/' + encodeURIComponent(x.path) + '/flat-colors' : '#/house/appearance/flat-colors';
      var sc = { kind: kind, x: x, b: sb, key: key || null, row: row, keys: keys, page: page, screen: screen,
                 href: page ? base + '/page/' + encodeURIComponent(key) : base, baseHref: base,
                 label: page ? (row ? row.label : key) : screen ? x.title : 'All Screens' };
      sc.own = function () {
        if (kind === 'house') return look.flat_colors || {};
        if (kind === 'screen') return (sb && sb.flat_colors) || {};
        if (kind === 'house-page') return (look.flat_page_colors || {})[key] || {};
        return ((sb && sb.flat_page_colors) || {})[key] || {};
      };
      sc.labelOf = function (k) { var r = self.skyRow(k, sb); return r ? r.label : null; };
      sc.resolved = function () { return M.flatColorsOf(look, sb, keys); };
      // a field as it would be with this scope's own taken away
      sc.parent = function (f) {
        var L = JSON.parse(JSON.stringify(look)), B = sb ? JSON.parse(JSON.stringify(sb)) : null;
        if (kind === 'screen') delete (B.flat_colors || {})[f];
        else if (kind === 'house-page') delete ((L.flat_page_colors || {})[key] || {})[f];
        else if (kind === 'screen-page') delete ((B.flat_page_colors || {})[key] || {})[f];
        return M.flatColorsOf(L, B, keys)[f];
      };
      return sc;
    }
    // SAVE a patch ({accent?, off_tint?}: a value, or null to inherit again
    // -- All Screens': Automatic) at the scope, shown at once; `whole`: the
    // scope's own replaced (a reset)
    flatColorsPut(sc, patch, whole) {
      var d = this.data, look = d.settings.look, ch = {};
      var made = function (o) {
        o = whole ? {} : Object.assign({}, o || {});
        Object.keys(patch).forEach(function (f) { if (patch[f] == null) delete o[f]; else o[f] = patch[f]; });
        return o;
      };
      if (sc.kind === 'house') {
        look.flat_colors = Object.assign({ accent: 'auto', off_tint: 'auto', pages: 'accent' }, made(look.flat_colors));
        if (whole) ch['look.flat_colors'] = look.flat_colors;
        else Object.keys(patch).forEach(function (f) { ch['look.flat_colors.' + f] = patch[f]; });
        return this.setH(ch);
      }
      if (sc.kind === 'house-page') {
        var hp = look.flat_page_colors = Object.assign({}, look.flat_page_colors), hv = made(hp[sc.key]);
        if (Object.keys(hv).length) hp[sc.key] = hv; else delete hp[sc.key];
        ch['look.flat_page_colors.' + sc.key] = whole ? (Object.keys(hv).length ? hv : null) : patch;
        return this.setH(ch);
      }
      var b = d.boards[sc.x.path] = Object.assign({}, d.boards[sc.x.path]);
      if (sc.kind === 'screen') {
        b.flat_colors = made(b.flat_colors);
        if (whole) ch.flat_colors = b.flat_colors;
        else Object.keys(patch).forEach(function (f) { ch['flat_colors.' + f] = patch[f]; });
      } else {
        var bp = b.flat_page_colors = Object.assign({}, b.flat_page_colors), bv = made(bp[sc.key]);
        if (Object.keys(bv).length) bp[sc.key] = bv; else delete bp[sc.key];
        ch['flat_page_colors.' + sc.key] = whole ? (Object.keys(bv).length ? bv : null) : patch;
      }
      return this.setB(sc.x.path, ch);
    }
    // "Just This Screen", "From Calendar on All Screens" ...: whose a field is
    flatFieldWhere(sc, name, f) {
      var own = sc.own()[name] != null;
      if (sc.kind === 'house') return null;
      if (own) return sc.kind === 'screen' ? 'Just This Screen' : sc.kind === 'house-page' ? 'Just This Page' : 'Just This Page Here';
      var src = M.flatSourceLabel(f, { label: sc.labelOf });
      return src ? 'From ' + src : null;
    }
    // A ROW THAT LEADS TO A SCOPE'S FLAT COLORS, with what it comes to
    flatColorsNav(sc, o) {
      o = o || {};
      var r = sc.resolved(), own = sc.own(), mine = own.accent != null || own.off_tint != null;
      var value = sc.kind === 'house' || mine || !sc.page || r.accent.scope === 'own-page' ? M.flatAccentSays(r.accent) +
                  (r.off_tint.value === 'accent' || r.off_tint.value === 'auto' ? '' : ' · Own Tint')
                : (o.inherited || 'Inherited');
      return K.nav({ label: o.label || 'Flat Colors', value: value, sub: o.sub || null, href: sc.href,
                     tile: o.tile === false ? null : ['mdi:palette-outline', M.flatColorHex(r.accent.value) || '#8e8e93'],
                     sk: (sc.screen ? 'b:' : 'look.') + (sc.page ? 'flat_page_colors:' + sc.key : 'flat_colors') });
    }
    // THE FLAT COLORS PAGE: the two fields (each its value and whose it
    // is), what the background does with them, each page's own, the resets
    flatColorsPage(c, sc) {
      var self = this, r = sc.resolved(), own = sc.own(), look = this.data.settings.look || {};
      if (sc.page && !sc.row) {
        c.appendChild(K.group({ footer: 'This page isn’t on ' + (sc.screen ? 'this screen' : 'any screen') + ', so it has no colors to choose.' }, []));
        return;
      }
      var flatOn = sc.screen ? this.flatHere(sc.b) : this.flatHere(null);
      var accentHex = M.flatColorHex(r.accent.value);
      var tintSays = r.off_tint.value === 'accent' ? (accentHex ? 'Match Accent' : 'Match Highlight') : M.flatColorName(r.off_tint.value);
      var foot = {
        house: 'In Flat, the Accent Color shades an Automatic background and colors the menu and tab bar. Off Pill Tint washes every pill that’s off; lit pills stay white. Each screen, page and room can choose its own.',
        screen: 'This screen’s own colors, over All Screens’. Page overrides take priority over general screen colors: a page with colors of its own, here or on All Screens, keeps them.',
        'house-page': 'This page on every screen, over the screens’ general colors. To change it on one screen only, choose it under that screen’s Flat Colors → Pages.',
        'screen-page': 'This page on this screen only. It wins over everything else.'
      }[sc.kind];
      if (!flatOn) foot += sc.screen ? ' This screen isn’t using Flat now: these wait until it is.' : ' All Screens isn’t using Flat now: these are the colors for any screen that is.';
      c.appendChild(K.group({ header: sc.page ? 'Flat Colors' : null, footer: foot }, [
        K.nav({ label: 'Accent Color', value: M.flatAccentSays(r.accent), sub: this.flatFieldWhere(sc, 'accent', r.accent),
                tile: accentHex ? ['', accentHex] : ['mdi:auto-fix', AUTO_ACCENT_TILE], href: sc.href + '/accent',
                sk: (sc.screen ? 'b:' : 'look.') + 'flat_colors:accent' }),
        K.nav({ label: 'Off Pill Tint', value: tintSays, sub: this.flatFieldWhere(sc, 'off_tint', r.off_tint),
                tile: M.flatColorHex(r.off_tint.value) ? ['', M.flatColorHex(r.off_tint.value)]
                    : r.off_tint.value === 'accent' ? ['mdi:link-variant', accentHex || '#8e8e93'] : ['mdi:auto-fix', AUTO_ACCENT_TILE],
                href: sc.href + '/tint', sk: (sc.screen ? 'b:' : 'look.') + 'flat_colors:off_tint' })]
        // WHETHER THE PAGES TAKE IT (All Screens and a screen: a page's own
        // accent is always its own)
        .concat(sc.page ? [] : [K.nav({ label: 'Pages', value: M.flatPagesName(r.pages.value),
                sub: sc.kind === 'screen' && sc.own().pages != null ? 'Just This Screen' : null,
                href: sc.href + '/pages', sk: (sc.screen ? 'b:' : 'look.') + 'flat_colors:pages' })])));
      this.flatBackgroundGroup(c, sc, r);
      if (!sc.page) this.flatColorsPages(c, sc);
      else if (sc.key === 'rooms') this.flatColorsRooms(c, sc);
      // THE RESETS: Automatic stops inheriting; inherited follows again
      var auto = r.accent.value === 'auto' && r.off_tint.value === 'auto';
      var mine = own.accent != null || own.off_tint != null;
      var acts = [];
      if (!auto) acts.push(K.button({ label: 'Restore Automatic Colors', fk: 'flatc:auto', onClick: function () {
        self.flatColorsPut(sc, { accent: 'auto', off_tint: 'auto' }).then(function (ok) { if (ok) self.announce('Automatic colors restored'); });
      } }));
      if (sc.kind !== 'house' && mine) acts.push(K.button({ label: sc.kind === 'screen' ? 'Reset to All Screens' : 'Use Inherited Colors', fk: 'flatc:inherit',
        onClick: function () { self.flatColorsPut(sc, {}, true).then(function (ok) { if (ok) self.announce('Colors inherited again'); }); } }));
      if (acts.length) {
        c.appendChild(K.group({ footer: sc.kind === 'house' ? 'Both back to Automatic: each page’s own Accent Color, each accessory’s own tint. The Background is its own setting.'
            : 'Restore Automatic Colors: Automatic here, whatever ' + (sc.kind === 'screen' ? 'All Screens chooses' : 'the screens choose') + '. ' +
              (mine ? (sc.kind === 'screen' ? 'Reset to All Screens' : 'Use Inherited Colors') + ': both fields follow ' + (sc.kind === 'screen' ? 'All Screens' : 'the screen and All Screens') + ' again. ' : '') +
              'The Background is its own setting.' }, acts));
      }
      // a screen of its own in Flat under a house in Glass: All Screens'
      // Flat Colors are still where its inherited colors come from
      if (sc.kind === 'screen' && !this.flatHere(null)) {
        c.appendChild(K.group({ footer: 'What this screen inherits. Editing them leaves All Screens’ own style as it is.' },
          [this.flatColorsNav(this.flatScope('house'), { label: 'All Screens’ Flat Colors' })]));
      }
    }
    // WHAT THE BACKGROUND DOES WITH THEM: an Automatic background takes the
    // accent's shade; a color, photo or landscape chosen keeps its own --
    // said, with a way to it and a deliberate way back to Automatic
    flatBackgroundGroup(c, sc, r) {
      var self = this, sky = this.data.settings.sky, b = sc.b, theme = this.flatTheme(b);
      var houseFlat = this.flatHere(null), src = null, label = null, href;
      var pageMode = null, pageScope = null;
      sc.keys.forEach(function (k) {
        if (pageMode) return;
        var mine = b && (b.sky_flat_pages || {})[k], all = (sky.flat_pages || {})[k];
        if (mine) { pageMode = mine; pageScope = 'screen'; } else if (all) { pageMode = all; pageScope = 'house'; }
      });
      if (pageMode && pageMode !== 'auto') { src = 'page'; label = this.flatModeLabel(pageMode, theme); }
      else if (!(sc.page && FLAT_OWN[sc.key])) {
        var bg = (b && b.sky_flat_background) || sky.flat_background || 'color';
        var col = bg === 'color' ? ((b && b.sky_flat_color) || sky.flat_color || 'auto') : null;
        if (bg !== 'color' || col !== 'auto') { src = b && (b.sky_flat_background || b.sky_flat_color) ? 'screen' : 'house'; label = bg === 'color' ? this.flatColorLabel(col, theme) : M.BG_LABELS[bg]; }
      }
      if (sc.page) href = sc.screen ? '#/screens/' + encodeURIComponent(sc.x.path) + '/sky/page/' + encodeURIComponent(sc.key)
                                   : (houseFlat ? '#/house/sky/page/' : '#/house/sky/flat/page/') + encodeURIComponent(sc.key);
      else href = sc.screen ? '#/screens/' + encodeURIComponent(sc.x.path) + '/sky' : houseFlat ? '#/house/sky' : '#/house/sky/flat';
      var seed = M.flatColorHex(r.accent.value);
      var rows = [K.nav({ label: 'Background', href: href, sk: 'flatc:background',
                          value: src ? label + ' · Separate Choice' : seed ? 'Matches Accent Color' : 'Automatic' })];
      if (src && seed) {
        rows.push(K.button({ label: 'Use Automatic Background', fk: 'flatc:bg-auto', onClick: function () {
          var done;
          if (src === 'page') {
            var put = pageScope === 'screen' ? self.flatPut(sc.x, b) : self.flatPut(null, null);
            var map = Object.assign({}, pageScope === 'screen' ? b.sky_flat_pages : sky.flat_pages);
            var pk = sc.keys.filter(function (k) { return map[k]; })[0];
            if (pageScope === 'screen' && (sky.flat_pages || {})[pk]) map[pk] = 'auto'; else delete map[pk];
            done = put({ sky_flat_pages: map });
          } else done = (src === 'screen' ? self.flatPut(sc.x, b) : self.flatPut(null, null))({ sky_flat_background: 'color', sky_flat_color: 'auto' });
          done.then(function (ok) { if (ok) self.announce('Background is Automatic'); });
        } }));
      }
      var say = src ? (seed ? 'A background you chose stays as it is: the accent colors the highlight and the pills, not it. Use Automatic Background to let it match.'
                            : 'A background you chose stays as it is.')
                    : seed ? 'An Automatic background is a very light (or, in Dark, very deep) shade of the Accent Color.'
                           : 'Automatic: ' + (sc.page && FLAT_OWN[sc.key] ? 'a shade of the page’s own Accent Color.' : 'the theme’s own ground.');
      c.appendChild(K.group({ header: 'Background', footer: say + (src === 'page' ? ' (Chosen for this page.)' : src ? ' (Chosen for ' + (src === 'screen' ? 'this screen' : 'All Screens') + '.)' : '') }, rows));
    }
    // EACH PAGE'S OWN, a tap away, from All Screens' or a screen's
    flatColorsPages(c, sc) {
      var self = this, rows = this.skyPageKeys(sc.b).rows;
      if (!rows.length) return;
      c.appendChild(K.group({ header: 'Pages', footer: 'A page left alone takes the colors above' + (sc.screen ? ', unless All Screens gives it its own.' : '.') },
        rows.map(function (row) {
          var ps = self.flatScope(sc.screen ? 'screen-page' : 'house-page', sc.x, sc.b, row.key);
          var hp = sc.screen ? self.flatScope('house-page', null, null, row.key) : null, hpo = hp ? hp.own() : {};
          return self.flatColorsNav(ps, { label: row.label, sub: row.custom ? 'Custom page' : null, tile: false,
            inherited: hp && (hpo.accent != null || hpo.off_tint != null) ? 'From All Screens' : sc.screen ? 'Same as This Screen' : 'Same as All Screens' });
        })));
    }
    flatColorsRooms(c, sc) {
      var self = this;
      var rows = this.areasAZ().map(function (aid) {
        var k = self.roomKey(aid);
        if (!k) return null;
        var rs = self.flatScope(sc.kind, sc.x, sc.b, k);
        return self.flatColorsNav(rs, { label: self.areaName(aid), tile: false, inherited: 'Same as Room Pages' });
      }).filter(Boolean);
      if (rows.length) c.appendChild(K.group({ header: 'Each Room', footer: 'A room’s own colors win over Room Pages’.' }, rows));
    }
    // ONE FIELD'S CHOICES: Same as / inherited, Automatic, then its colors
    flatColorsPick(c, sc, f) {
      var self = this, r = sc.resolved(), own = sc.own()[f], cur = r[f].value, house = sc.kind === 'house';
      var pick = function (v) {
        var patch = f === 'accent' && v != null ? M.flatAccentChange(v, r) : (function () { var p = {}; p[f] = v; return p; })();
        self.flatColorsPut(sc, patch).then(function (ok) {
          if (ok && patch.off_tint === 'accent') self.announce('Off Pill Tint now matches the accent');
        });
      };
      var rows = [];
      if (!house) {
        var par = sc.parent(f), src = M.flatSourceLabel(par, { label: sc.labelOf });
        rows.push(K.check({ label: sc.kind === 'screen' ? 'Same as All Screens' : 'Use Inherited ' + (f === 'accent' ? 'Color' : 'Tint'),
                            sub: 'Now ' + M.flatColorName(par.value) + (src ? ' · ' + src : ''), on: own == null, fk: 'flatc:' + f + ':inherit',
                            onClick: function () { pick(null); } }));
      }
      var isOwn = function (v) { return (house || own != null) && cur === v; };
      if (f === 'accent') {
        rows.push(K.check({ label: 'Automatic', sub: 'Each page’s own Accent Color, as in the other looks; Home and the rooms orange',
                            tile: ['mdi:auto-fix', AUTO_ACCENT_TILE], on: isOwn('auto'), fk: 'flatc:accent:auto', onClick: function () { pick('auto'); } }));
        M.FLAT_ACCENTS.forEach(function (p) {
          rows.push(K.check({ label: p[1], tile: ['', p[2]], on: isOwn(p[2]), fk: 'flatc:accent:' + p[0], onClick: function () { pick(p[2]); } }));
        });
      } else {
        var acc = M.flatColorHex(r.accent.value);
        rows.push(K.check({ label: 'Automatic', sub: 'Each accessory in a wash of its own color. Flat Dark keeps its plain pills.',
                            tile: ['mdi:auto-fix', AUTO_ACCENT_TILE], on: isOwn('auto'), fk: 'flatc:tint:auto', onClick: function () { pick('auto'); } }));
        rows.push(K.check({ label: 'Match Accent', sub: acc ? 'Now ' + M.flatColorName(r.accent.value) + ', and whatever it becomes' : 'The page’s highlight, while the Accent Color is Automatic',
                            tile: ['mdi:link-variant', acc || '#8e8e93'], on: isOwn('accent'), fk: 'flatc:tint:accent', onClick: function () { pick('accent'); } }));
      }
      var named = (f === 'accent' ? M.FLAT_ACCENTS.map(function (p) { return p[2]; }) : []).concat(['auto', 'accent']);
      var custom = (house || own != null) && named.indexOf(cur) < 0;
      var start = M.flatColorHex(cur) || (f === 'accent' ? '#8872b4' : '#789484');
      var row = K.text({ label: 'Your Own Color', sub: custom ? start.toUpperCase() : f === 'accent' ? 'Pick any color.' : 'One tint for every pill, whatever the accent.',
                         type: 'color', fk: 'flatc:' + f + ':custom', value: start, error: this.err((sc.screen ? 'b:' : 'look.') + 'flat_colors.' + f),
                         onCommit: function (t) { if (/^#[0-9a-f]{6}$/i.test(t)) pick(t.toLowerCase()); } });
      var inp = row.querySelector('input');
      if (inp) {
        inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
        inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) pick(inp.value.toLowerCase()); });
      }
      if (custom) row.classList.add('on');
      rows.push(row);
      var foot = f === 'accent'
        ? 'Shades an Automatic background and colors the menu and tab bar: its icons and the page you’re on. Chosen while Off Pill Tint is Automatic, it sets the tint to Match Accent too; a tint of your own stays. The Highlight Color stays saved for the other looks.'
        : 'The wash on pills that are off, and their circles. Lit pills stay white with their own colors; alerts and warnings keep theirs.';
      c.appendChild(K.group({ header: f === 'accent' ? 'Accent Color' : 'Off Pill Tint', footer: foot }, rows));
    }
    // THE PAGES THAT HAVE A COLOR OF THEIR OWN: the accent, or theirs
    flatPagesPick(c, sc) {
      var self = this, own = sc.own().pages, cur = sc.resolved().pages.value, house = sc.kind === 'house';
      var pick = function (v) { self.flatColorsPut(sc, { pages: v }); };
      var on = function (v) { return (house || own != null) && cur === v; };
      var rows = [];
      if (!house) {
        var par = M.flatColorsOf(this.data.settings.look || {}, null, []).pages.value;
        rows.push(K.check({ label: 'Same as All Screens', sub: 'Now ' + M.flatPagesName(par), on: own == null, fk: 'flatc:pages:inherit',
                            onClick: function () { pick(null); } }));
      }
      rows.push(K.check({ label: 'Follow Accent', sub: 'Every page in the Accent Color', on: on('accent'), fk: 'flatc:pages:accent',
                          onClick: function () { pick('accent'); } }));
      rows.push(K.check({ label: 'Keep Their Own Colors', sub: 'Climate blue, Lights yellow, Calendar purple…', on: on('own'), fk: 'flatc:pages:own',
                          onClick: function () { pick('own'); } }));
      c.appendChild(K.group({ footer: 'Pages like Climate and Lights have a color of their own (each page → Look → Highlight Color). Keep Their Own Colors leaves those pages in it, as Automatic does; Home and the rooms take the Accent Color either way. A page given Flat Colors of its own keeps them.' }, rows));
    }
    // the pages of a scope's routes: [] its Flat Colors, ['accent'], ['tint'],
    // ['page', key, ...] a page's
    p_flatColors(kind, x, b, sub, mk, backTo) {
      var self = this, page = sub[0] === 'page' && sub[1], key = page ? decodeURIComponent(sub[1]) : null, rest = page ? sub.slice(2) : sub;
      var sc = this.flatScope(page ? (kind === 'screen' ? 'screen-page' : 'house-page') : kind, x, b, key);
      var top = sc.page ? (sc.row ? sc.row.label : 'Page') : 'Flat Colors';
      var parent = sc.page ? (sc.row && sc.row.room && key !== 'rooms' ? ['Room Pages', sc.baseHref + '/page/rooms'] : ['Flat Colors', sc.baseHref]) : backTo;
      if (rest[0] === 'pages' && !sc.page) return mk('Pages', function (c) { self.flatPagesPick(c, sc); }, [top, sc.href]);
      if (rest[0] === 'accent' || rest[0] === 'tint') {
        return mk(rest[0] === 'accent' ? 'Accent Color' : 'Off Pill Tint', function (c) { self.flatColorsPick(c, sc, rest[0] === 'accent' ? 'accent' : 'off_tint'); }, [top, sc.href]);
      }
      var out = mk(top, function (c) { self.flatColorsPage(c, sc); }, parent);
      // A PAGE'S COLORS PREVIEW THAT PAGE (its address, as the strategy names it)
      var view = sc.page && sc.screen ? (FLAT_VIEW[key] || (key === 'rooms' ? null : key)) : null;
      if (view && out.preview) out.previewView = view;
      return out;
    }
    h_theme(c, t) {
      var self = this, sky = this.data.settings.sky, themes = sky.themes || [], on = themes.indexOf(t.id) >= 0;
      var built = (this.data.choices || {}).sky_built_in || {};
      c.appendChild(K.group({ footer: t.desc }, [K.toggle({ label: 'Show ' + t.label, sk: 'sky.themes:' + t.id, on: on,
        onChange: function (v) {
          var all = (self.data.choices || {}).themes || [];
          self.setH({ 'sky.themes': all.filter(function (x) { return x === t.id ? v : themes.indexOf(x) >= 0; }) });
        } })]));
      if (on) this.livelyGroup(c, t.id);
      if (t.id === 'birthday') { this.h_birthdays(c); return; }
      if (t.dates) {
        var from = M.skyDate(sky, built, t.dates, 'from'), to = M.skyDate(sky, built, t.dates, 'to');
        var rows = [this.dateRow('Starts', t.dates + '_from', from, false), this.dateRow('Ends', t.dates + '_to', to, t.dates === 'thanksgiving')];
        if (from.own || to.own) rows.push(K.button({ label: 'Reset to Default Dates', fk: 'sky:dates:reset', onClick: function () {
          var o = {}; o['sky.' + t.dates + '_from'] = null; o['sky.' + t.dates + '_to'] = null; self.setH(o);
        } }));
        c.appendChild(K.group({ header: 'Dates', footer: 'Default: ' + M.dateLabel(from.builtIn) + ' to ' + M.dateLabel(to.builtIn) +
          (t.id === 'spring-garden' || t.id === 'winter-wonderland' ? ', for your hemisphere.' : '.') }, rows.map(function (r, i) {
          return i < 2 ? self.withError(r, 'sky.' + t.dates + (i ? '_to' : '_from')) : r;
        })));
      }
      if (t.often) {
        var labels = M.OFTEN_LABELS[t.often] || {};
        // DAYS (it was "How Often"): which days it shows -- "often" is
        // Liveliness's word, for how often its crossers come by
        var often = [K.select({ label: 'Days', sk: 'sky.' + t.often, value: sky[t.often] || M.OFTEN_DEFAULT[t.often] || 'sometimes',
          options: Object.keys(labels).map(function (k) { return [k, labels[k]]; }),
          onChange: function (v) { var o = {}; o['sky.' + t.often] = v; self.setH(o); } })];
        if (t.extra) {
          var l2 = M.OFTEN_LABELS[t.extra];
          often.push(K.seg({ label: 'Spooky Nights', sub: 'A big moon, fog, bats and a witch', sk: 'sky.' + t.extra, stack: !self.hasAttribute('wide'),
            value: sky[t.extra] || 'sometimes', options: Object.keys(l2).map(function (k) { return [k, l2[k]]; }),
            onChange: function (v) { var o = {}; o['sky.' + t.extra] = v; self.setH(o); } }));
        }
        var ofoot = /_per_month$/.test(t.often) ? 'On its own fixed days each month, never the same day as the other.' :
          /^spring/.test(t.often) ? 'Sometimes is about one day in seven.' :
          /^winter/.test(t.often) ? 'Sometimes is about one day in eight.' :
          'Sometimes: some days, more often as the last day nears, and always the final days.';
        c.appendChild(K.group({ footer: ofoot }, often));
      }
    }
    dateRow(label, key, d, allowThanksgiving) {
      var self = this, cur = d.value, md = M.mmdd(cur);
      var monthSel = h('select', { 'aria-label': label + ' month', 'data-fk': 'date:' + key + ':m' });
      var opts = (allowThanksgiving ? [['thanksgiving', 'Thanksgiving Day']] : []).concat(M.MONTHS.map(function (m, i) {
        return [String(i + 1), m]; }));
      var curM = cur === 'thanksgiving' ? 'thanksgiving' : md ? String(md.month) : '';
      opts.forEach(function (o) { var e = h('option', { value: o[0], text: o[1] }); if (o[0] === curM) e.selected = true; monthSel.appendChild(e); });
      var daySel = h('select', { 'aria-label': label + ' day', 'data-fk': 'date:' + key + ':d' });
      for (var i = 1; i <= 31; i++) { var e = h('option', { value: String(i), text: String(i) }); if (md && md.day === i) e.selected = true; daySel.appendChild(e); }
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var commit = function () {
        var o = {};
        o['sky.' + key] = monthSel.value === 'thanksgiving' ? 'Thanksgiving Day' : pad(Number(monthSel.value)) + '-' + pad(Number(daySel.value));
        self.setH(o);
      };
      monthSel.addEventListener('change', commit);
      daySel.addEventListener('change', commit);
      var pop = function (sel, text) {
        return h('span', { class: 'pop' }, [h('span', { class: 'pv', text: text }), sel]);
      };
      var box = h('span', { class: 'dated' }, [pop(monthSel, curM === 'thanksgiving' ? 'Thanksgiving Day' : md ? M.MONTHS[md.month - 1].slice(0, 3) : '—')]);
      if (curM !== 'thanksgiving') box.appendChild(pop(daySel, md ? String(md.day) : '—'));
      return h('div', { class: 'cell', 'data-sk': 'sky.' + key }, [K.label(label, d.own ? null : 'Default'), box]);
    }
    h_birthdays(c) {
      var self = this, list = (this.data.settings.sky.birthdays || []).slice();
      var save = function (v) { self.setH({ 'sky.birthdays': v }); };
      var rows = list.map(function (b, i) {
        var rm = h('button', { class: 'lx rm', type: 'button', 'aria-label': 'Remove ' + b.name, 'data-fk': 'bd:rm:' + i });
        rm.appendChild(K.svg('<svg viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="var(--hk-red)"/><path d="M6.5 11h9" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>'));
        rm.addEventListener('click', function () { save(list.filter(function (x, j) { return j !== i; })); });
        return h('div', { class: 'cell li' }, [rm, K.label(b.name), h('span', { class: 'val', text: M.MONTHS[b.month - 1] + ' ' + b.day })]);
      });
      if (!rows.length) rows.push(K.info({ label: 'No birthdays yet' }));
      c.appendChild(K.group({ header: 'Birthdays' }, rows));
      var nb = this._nb = this._nb || { name: '', month: '1', day: '1' };
      var nm = h('input', { type: 'text', placeholder: 'Name', 'aria-label': 'Name', maxlength: 40, 'data-fk': 'bd:name' });
      nm.value = nb.name;
      nm.addEventListener('input', function () { nb.name = nm.value; });
      var ms = h('select', { 'aria-label': 'Month', 'data-fk': 'bd:m' });
      M.MONTHS.forEach(function (m, i) { var o = h('option', { value: String(i + 1), text: m }); if (String(i + 1) === nb.month) o.selected = true; ms.appendChild(o); });
      ms.addEventListener('change', function () { nb.month = ms.value; });
      var ds = h('select', { 'aria-label': 'Day', 'data-fk': 'bd:d' });
      for (var i = 1; i <= 31; i++) { var o = h('option', { value: String(i), text: String(i) }); if (String(i) === nb.day) o.selected = true; ds.appendChild(o); }
      ds.addEventListener('change', function () { nb.day = ds.value; });
      var add = h('button', { class: 'pbtn', type: 'button', text: 'Add', 'data-fk': 'bd:add' });
      add.addEventListener('click', function () {
        if (!nb.name.trim()) { nm.focus(); self.announce('Enter a name.'); return; }
        save(list.concat({ name: nb.name.trim(), month: Number(nb.month), day: Number(nb.day) }));
        self._nb = null;
      });
      var box = h('div', { class: 'inl' }, [nm, ms, ds, add]);
      var g = K.group({ header: 'Add Birthday', footer: 'Balloons and confetti on the day.' }, []);
      g.querySelector('.cells').appendChild(box);
      c.appendChild(g);
      if (this.err('sky.birthdays')) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('sky.birthdays') }));
    }
    h_skyAdvanced(c) {
      var self = this, sky = this.data.settings.sky, set = function (k) { return function (v) { var o = {}; o[k] = v; self.setH(o); }; };
      c.appendChild(K.group({ footer: 'Southern moves the default spring and winter dates by six months.' }, [
        K.seg({ label: 'Hemisphere', sk: 'sky.hemisphere', value: sky.hemisphere === 'south' ? 'south' : 'north',
                options: [['north', 'Northern'], ['south', 'Southern']], onChange: set('sky.hemisphere') })]));
      c.appendChild(K.group({ header: 'Sources', footer: 'Optional. A holiday sensor’s state is Halloween, Thanksgiving or Christmas; the dates then only limit when the sky decorates. A moon sensor gives the phase from 0 to 1.' }, [
        this.entityRow({ label: 'Holiday Season', sk: 'sky.holidays', value: sky.holidays, none: 'From the Dates',
                         filter: { domains: ['sensor'] }, onPick: set('sky.holidays') }),
        this.entityRow({ label: 'Moon Phase', sk: 'sky.moon', value: sky.moon, none: 'Computed',
                         filter: { domains: ['sensor'] }, onPick: set('sky.moon') })]));
      c.appendChild(K.group({ header: 'Decorations Also Need', footer: 'Another on/off that must also be on for the decorations to show.' }, [
        this.entityRow({ label: 'Also Needs', sk: 'sky.seasonal', value: sky.seasonal, none: 'Nothing Else',
                         filter: { domains: ['input_boolean', 'switch'] }, onPick: set('sky.seasonal') })]));
    }
    // ALL SCREENS' MENU (2026-10-02): every menu setting, for every screen
    // that doesn't set its own; whether a screen has a menu -- a button, or
    // always open -- is each screen's.
    h_menu(c) {
      var self = this, v = M.houseMenuAsBoard(this.data.settings.menu);
      var set = function (ch) { return self.setH(M.houseMenuSave(ch)); };
      this.menuRows(c, v, set, { house: true, base: '#/house/menu' });
      var bd = this.data.boards || {}, rows = [];
      Object.keys(bd).forEach(function (p) {
        var b = bd[p];
        if (!b) return;
        var d = self.dash(p);
        if (M.menuMode(b) === 'off' && M.phoneMenu(b) === 'off') return;
        rows.push(K.nav({ label: d ? d.title : p, value: M.menuSummary(b), href: '#/screens/' + encodeURIComponent(p) + '/menu',
                          fk: 'menu:screen:' + p }));
      });
      if (rows.length) {
        c.appendChild(K.group({ header: 'Each Screen’s Menu Settings', footer: 'Same as All Screens follows this page; Just This ' +
            'Screen keeps its own. Each screen’s menu on each device is in Tablets & Computers and Phones above.' }, rows));
      }
    }
    // ---------------------------------------------------------- rooms
    // ROOMS, ALL SCREENS (2026-10-01): one place for everything about rooms.
    // The order and which are on Home, the menu's and the pages' -- for every
    // screen whose Rooms are Same as All Screens -- the room pages' headings
    // and status row, and every room, each with a page of its own settings
    // (on every screen): shown or hidden, on Home, part of another room,
    // its tile order and its scenes.
    houseRooms() { return M.houseRoomsAsBoard(this.data.settings.rooms); }
    // a room's own page (Rooms, All Screens), from any list of rooms
    roomHref(a) { return '#/house/rooms/' + encodeURIComponent(a); }
    roomFollowers() {
      var bd = this.data.boards || {};
      return Object.keys(bd).filter(function (p) { return !bd[p].rooms_custom; });
    }
    // ALL SCREENS' CAMERAS (2026-10-09): which cameras and in what order --
    // every screen's Home strip and Cameras page, and the room pages' cameras
    // in that order -- unless a screen sets its own (that screen -> Cameras).
    h_cameras(c) {
      var self = this, ents = this.client.entities || {};
      var ok = this.entityIds({ domains: ['camera'], shown: true }).filter(function (id) { return !self.notHouseCamera(id); }).sort();
      var autoCams = M.autoCameras(ok, function (id) { return (ents[id] || {}).device_id; });
      var save = function (v) { return self.setH({ 'cameras.order': v }); };
      var bd = this.data.boards || {}, own = Object.keys(bd).filter(function (p) { return bd[p].cameras_custom; });
      c.appendChild(K.group({ footer: own.length
          ? 'Every screen follows these except ' + own.map(function (p) { var d = self.dash(p); return d ? d.title : p; }).join(', ') +
            ', which set' + (own.length === 1 ? 's its' : ' their') + ' own (that screen → Home Page → Cameras).'
          : 'Every screen follows these: its camera strip on Home, its Cameras page, and the cameras on the room pages, in this order. A screen can set its own in its Cameras.' }, [
        K.info({ label: 'Screens Following', value: (Object.keys(bd).length - own.length) + ' of ' + Object.keys(bd).length })]));
      // LIVE FIRST CAMERA (2026-10-10): the strip's first tile live, or a
      // snapshot like the others (hk-cameras.js _liveOn)
      var live = (this.data.settings.cameras || {}).live !== false;
      var ownLive = Object.keys(bd).filter(function (p) { return typeof bd[p].camera_live_video === 'boolean'; });
      c.appendChild(K.group({ header: 'Camera Strip on Home', footer: 'On, the first tile plays live video and the others show snapshots. ' +
          'Off, the first tile is a snapshot too — no video to decode, which is lighter on a computer or an older tablet. ' +
          'The Cameras page and the camera pop-ups still play live.' +
          (ownLive.length ? ' ' + ownLive.map(function (p) { var d = self.dash(p); return d ? d.title : p; }).join(', ') +
            (ownLive.length === 1 ? ' sets its own.' : ' set their own.') : ' A screen can set its own in its Cameras.') }, [
        K.toggle({ label: 'Live First Camera', sk: 'cameras.live', on: live, onChange: function (on) { self.setH({ 'cameras.live': on }); } })]));
      // PAUSE WHEN NOT IN FOCUS (2026-10-21): a computer's live cameras rest
      // while another window is in front -- the sky's own setting is apart,
      // since a window of cameras is often kept beside other work
      c.appendChild(K.group({ footer: 'On a computer, live cameras stop while another window is in front, and start again when you come back. ' +
          'Turn this off to keep watching cameras in a window beside your work. Behind the screensaver, cameras always stop.' }, [
        K.toggle({ label: 'Pause When Not in Focus', sk: 'cameras.focus_pause', on: (this.data.settings.cameras || {}).focus_pause !== false,
          onChange: function (on) { self.setH({ 'cameras.focus_pause': on }); } })]));
      var mdl = M.camerasModel({ cameras: ((this.data.settings.cameras || {}).order || []) }, ok, autoCams);
      c.appendChild(K.listEditor({ fk: 'house-cams', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
        autoFooter: 'Automatic shows one of every camera, its low-resolution channel.',
        rows: mdl.rows.map(function (r) { return { value: r.value, label: self.name(r.value) }; }),
        more: mdl.more.map(function (r) { return { value: r.value, label: self.name(r.value) }; }),
        onAuto: function (on) {
          if (!on) { save(mdl.rows.map(function (r) { return r.value; })); return; }
          self.confirmSwitch({ title: 'Use Automatic Cameras?', message: 'All Screens’ camera order and choices will be replaced.', ok: 'Use Automatic' },
              function () { save([]); });
        },
        onChange: function (v) { save(v); } }));
      this.cameraRelated(c, null);
    }
    // EVERYTHING ELSE ABOUT CAMERAS, from either Cameras page (2026-10-10):
    // the pop-ups that show one, each screen's own strip (its Live Camera
    // Follows, its own list), the Cameras page's background, and cameras
    // hidden from every screen. `x`: the screen whose Cameras this is.
    cameraRelated(c, x) {
      var self = this, bd = this.data.boards || {}, pops = this.data.popups || [];
      var camPops = pops.filter(function (p) { return p.kind === 'camera'; }).length;
      var rows = [K.nav({ label: 'Pop-ups', sub: 'The doorbell and other camera sheets an automation opens',
                          value: camPops ? camPops + (camPops === 1 ? ' Camera Pop-up' : ' Camera Pop-ups') : 'None Yet',
                          href: '#/popups', icon: 'mdi:doorbell-video', fk: 'cams-rel:popups' })];
      if (x) {
        rows.push(K.nav({ label: 'Cameras for All Screens', sub: 'The camera list and Live First Camera every screen starts from',
                          href: '#/page/cameras', icon: 'mdi:cctv', fk: 'cams-rel:house' }));
      } else {
        // the screens with a Home strip: not a page screen (no Home) nor one
        // whose Home is a page of its own (the car's)
        this.data.dashboards.filter(function (d) {
          var b = d.item && bd[d.path];
          return b && b.home_page !== false && !b.home_view;
        }).forEach(function (d) {
          var b = bd[d.path], notes = [];
          if (b.camera_strip === false) notes.push('No Strip');
          else {
            if (b.camera_live) notes.push('Live Follows ' + self.name(b.camera_live));
            if (b.cameras_custom) notes.push('Own Cameras');
            if (typeof b.camera_live_video === 'boolean') notes.push(b.camera_live_video ? 'Live' : 'No Live');
          }
          rows.push(K.nav({ label: d.title + ' Camera Strip', value: notes.join(' · '), icon: 'mdi:monitor-dashboard',
                            href: '#/screens/' + encodeURIComponent(d.path) + '/cameras', fk: 'cams-rel:' + d.path }));
        });
      }
      rows.push(K.nav({ label: 'Cameras Page Background', sub: 'Its own color, the live sky or a backdrop',
                        href: x ? '#/screens/' + encodeURIComponent(x.path) + '/sky/page/cameras' : '#/page/cameras/background',
                        icon: 'mdi:palette', fk: 'cams-rel:bg' }));
      rows.push(K.nav({ label: 'Hidden Accessories', sub: 'A camera hidden there shows on no screen', href: '#/accessories/hidden',
                        icon: 'mdi:eye-off', fk: 'cams-rel:hidden' }));
      c.appendChild(K.group({ header: 'Related' }, rows));
    }
    h_rooms(c) {
      var self = this, rooms = this.data.settings.rooms, hb = this.houseRooms(), wide = this.hasAttribute('wide');
      var setR = function (ch) { return self.setH(M.houseRoomsSave(ch)); };
      var bd = this.data.boards || {}, own = Object.keys(bd).filter(function (p) { return bd[p].rooms_custom; });
      c.appendChild(K.group({ header: 'Order', footer: own.length
          ? 'Every screen follows these except ' + own.map(function (p) { var d = self.dash(p); return d ? d.title : p; }).join(', ') +
            ', which set' + (own.length === 1 ? 's its' : ' their') + ' own (that screen → Rooms).'
          : 'Every screen follows these. A screen can set its own in its Rooms.' }, [
        K.nav({ label: 'Room Order', value: M.roomsSummary(hb), href: '#/house/rooms/order', sk: 'rooms.order' }),
        K.seg({ label: 'Rooms in Menu', sk: 'rooms.menu', value: hb.menu_rooms, stack: !wide,
                options: [['az', 'A to Z'], ['order', 'Room Order']], onChange: function (v) { setR({ menu_rooms: v }); } }),
        K.seg({ label: 'Rooms on Pages', sub: 'Lights, Climate, Water and the other pages that group by room.', sk: 'rooms.pages',
                value: hb.page_rooms, stack: !wide, options: [['floor', 'By Floor'], ['order', 'Room Order']],
                onChange: function (v) { setR({ page_rooms: v }); } })]));
      var st = rooms.status || [];
      c.appendChild(K.group({ header: 'Room Pages', footer: 'A room page shows its readings and what’s open or on at the top. Temperature and humidity are the area’s own sensors (Settings → Areas).' }, [
        K.toggle({ label: 'Room Headings Open Room Pages', sk: 'rooms.headings', on: rooms.headings !== false,
                   onChange: function (on) { self.setH({ 'rooms.headings': on }); } }),
        K.nav({ label: 'Status Row', value: M.statusSummary(st), href: '#/house/rooms/status', sk: 'rooms.status' })]));
      var areas = (this.client && this.client.areas) || {}, az = this.areasAZ();
      var g = this.data.settings.generated || {}, hidden = g.exclude_areas || [];
      var into = ((this.data.accessories || {}).into) || {};
      var onHome = M.roomsModel(hb, az).rows.map(function (r) { return r.value; });
      c.appendChild(K.group({ header: 'Rooms', footer: 'Each room’s own settings — its scenes, its tile order, whether it shows — on every screen.' },
        az.map(function (a) {
          var notes = [];
          if (hidden.indexOf(a) >= 0) notes.push('Hidden');
          else if (into[a] && areas[into[a]]) notes.push('In ' + self.areaName(into[a]));
          else if (onHome.indexOf(a) < 0) notes.push('Not on Home');
          var sc = (((self.data.accessories || {}).scenes || {})[a]);
          if (!notes.length && Array.isArray(sc) && sc.length) notes.push(sc.length + (sc.length === 1 ? ' Scene' : ' Scenes'));
          return K.nav({ label: areas[a].name, icon: areas[a].icon || 'mdi:texture-box', value: notes.join(' · '),
                         href: '#/house/rooms/' + encodeURIComponent(a), sk: 'room:' + a });
        })));
    }
    h_roomOrder(c) {
      var self = this, hb = this.houseRooms(), az = this.areasAZ(), areas = (this.client && this.client.areas) || {};
      var mdl = M.roomsModel(hb, az);
      var setR = function (ch) { return self.setH(M.houseRoomsSave(ch)); };
      var icon = function (a) { return (areas[a] || {}).icon || 'mdi:texture-box'; };
      c.appendChild(K.listEditor({ fk: 'hrooms', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
        autoFooter: 'Automatic: Home shows its rooms floor by floor, then A to Z.',
        shownHeader: 'On Home', moreHeader: 'Not on Home',
        moreFooter: 'A room that isn’t on Home keeps its page and its row in the menu. Tap a room for its own settings.',
        rows: mdl.rows.map(function (r) { return { value: r.value, label: self.areaName(r.value), icon: icon(r.value), href: self.roomHref(r.value) }; }),
        more: mdl.more.map(function (r) { return { value: r.value, label: self.areaName(r.value), icon: icon(r.value) }; }),
        onAuto: function (on) {
          if (!on) { setR({ room_order: az.slice(), home_rooms: 'order' }); return; }
          self.confirmSwitch({ title: 'Use Automatic Rooms?', message: 'The room order and choices for All Screens will be replaced.', ok: 'Use Automatic' },
              function () { setR(M.roomsAuto()); });
        },
        onChange: function (v) { setR(M.roomsSave(v, az)); } }));
      c.appendChild(K.group({ footer: 'For every screen whose Rooms are Same as All Screens. The order is also the menu’s and the pages’, where those say Room Order.' }, []));
    }
    h_room(c, aid) {
      var self = this, client = this.client, areas = client.areas || {}, az = this.areasAZ();
      var g = this.data.settings.generated || {}, hidden = (g.exclude_areas || []).slice(), shown = hidden.indexOf(aid) < 0;
      var hb = this.houseRooms(), onHome = M.roomsModel(hb, az).rows.some(function (r) { return r.value === aid; });
      var into = ((this.data.accessories || {}).into || {})[aid] || '';
      var order = ((this.data.accessories || {}).rooms || {})[aid] || [];
      var nAcc = this.accIds().filter(function (id) { return self.areaOf(id) === aid; }).length;
      var own = Object.keys(this.data.boards || {}).filter(function (p) { return self.data.boards[p].rooms_custom; });
      c.appendChild(K.group({ header: 'On Screens', footer: (shown ? 'Show on Home is All Screens’ room order' +
          (own.length ? '; a screen with Rooms of its own keeps its own.' : '.') + ' ' : '') +
          'Hidden: left off every generated screen, with its accessories, and never counted by a chip.' }, [
        K.toggle({ label: 'Show on Screens', sk: 'room:shown:' + aid, on: shown, onChange: function (on) {
          self.setH({ 'generated.exclude_areas': on ? hidden.filter(function (a) { return a !== aid; }) : hidden.concat(aid) });
        } })].concat(shown ? [
        K.toggle({ label: 'Show on Home', sk: 'room:home:' + aid, on: onHome, onChange: function (on) {
          var ch = M.roomOnHome(hb, az, aid, on);
          if (ch) self.setH(M.houseRoomsSave(ch));
        } }),
        K.select({ label: 'Show As Part Of', sk: 'into:' + aid, value: into,
          options: [['', 'Its Own Room']].concat(az.filter(function (a) { return a !== aid; }).map(function (a) { return [a, areas[a].name]; })),
          onChange: function (v) { self.ws({ type: DOMAIN + '/accessory/into', area_id: aid, into: v || null }); } })] : [])));
      if (shown) {
        c.appendChild(K.group({ header: 'Room Page', footer: into ? 'Shown as part of ' + this.areaName(into) + ': its scenes and tile order join that room’s.' :
            'A row of scene pills under the room’s status and cameras, and the order of its tiles — here and on Home.' }, [
          K.nav({ label: 'Scenes', value: this.roomScenesLabel(aid), sk: 'accessories.scenes.' + aid,
                  href: '#/house/rooms/' + encodeURIComponent(aid) + '/scenes' }),
          K.nav({ label: 'Tile Order', value: order.length ? 'Custom' : 'Automatic',
                  href: '#/house/rooms/' + encodeURIComponent(aid) + '/order', sk: 'room:order:' + aid })]));
      }
      c.appendChild(K.group({ footer: 'Each accessory’s name, icon, tile size and more.' }, [
        K.nav({ label: 'Accessories', value: String(nAcc), href: '#/accessories/room/' + encodeURIComponent(aid), icon: 'mdi:lightbulb-group' })]));
      // ITS PAGE'S BACKGROUND (2026-10-13): a photo of the room, say -- the
      // same page as Sky / Background -> Room Pages -> Each Room
      var rk = this.roomKey(aid);
      if (shown && rk) {
        var rflat = this.flatHere(null), rm = rflat ? this.flatPageNow({ key: rk, room: true }, null) : this.skyPageNow({ key: rk, room: true }, null);
        c.appendChild(K.group({ footer: 'Behind this room’s page on every screen: Same as Room Pages, ' + (rflat ? 'Automatic' : 'the Live Sky') + ', a Color or a Photo. A screen can choose its own.' }, [
          K.nav({ label: 'Background', icon: 'mdi:image-outline', sk: (rflat ? 'sky.flat_pages:' : 'sky.pages:') + rk, href: '#/house/sky/page/' + encodeURIComponent(rk),
                  value: rm.own ? (rflat ? this.flatModeLabel(rm.mode, this.flatTheme(null)) : M.skyModeLabel(rm.mode, (this.data.choices || {}).sky_backdrops || [])) : 'Same as Room Pages' })]
          .concat(this.flatAnywhere() ? [this.flatColorsNav(this.flatScope('house-page', null, null, rk), { icon: 'mdi:palette-outline', inherited: 'Same as Room Pages' })] : [])));
      }
    }
    // A ROOM PAGE'S OWN BACKGROUND KEY: its address, as the screens name it
    // (hk-strategy.js: 'room-' + slug(area id)) -- null if too long to store
    roomKey(aid) {
      var k = 'room-' + String(aid || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return k.length <= 40 && k.length > 5 ? k : null;
    }
    // a page row for its background page: one of the screen's pages, or a
    // room ({key: 'room-...', room: true, label: its name})
    skyRow(key, b) {
      var row = this.skyPageKeys(b).rows.filter(function (r) { return r.key === key; })[0];
      if (row || !/^room-/.test(key)) return row || null;
      var self = this, aid = this.areasAZ().filter(function (a) { return self.roomKey(a) === key; })[0];
      return aid ? { key: key, label: this.areaName(aid), room: true, aid: aid } : null;
    }
    h_music(c) {
      var self = this, browse = this.data.settings.browse, look = this.data.settings.look;
      // THE MUSIC FEATURE'S OWN SETTINGS first (hk-settings-features.js)
      F.musicTop(this, c);
      var cats = (this.data.choices || {}).browse_categories || [];
      c.appendChild(K.group({ header: 'Browse', footer: 'The Browse side of every screen’s Music page. A page whose YAML lists its own keeps them.' }, [
        K.nav({ label: 'Categories', value: (cats.length - (browse.hide || []).length) + ' of ' + cats.length + ' Shown', href: '#/features/music/categories', sk: 'browse.hide' }),
        K.nav({ label: 'Discover Rows', value: (browse.discover || []).length ? String(browse.discover.length) : 'None', href: '#/features/music/discover', sk: 'browse.discover' })]));
      c.appendChild(K.group({ header: 'Advanced', footer: 'The page a speaker’s sheet opens with Browse, on screens written in YAML (generated screens always use their own). Empty: no Browse button.' }, [
        K.text({ label: 'Browse Page', sk: 'look.browse_view', value: look.browse_view, placeholder: 'None', error: this.err('look.browse_view'),
                 onCommit: function (v) { self.setH({ 'look.browse_view': v }); } })]));
      if (F.stateOf(this.data.features, 'hk_music') === 'added') {
        c.appendChild(K.group({}, [K.nav({ label: 'Music', sub: 'In ' + haPlace('Devices & Services'), href: F.integrationHref('hk_music'),
                                           icon: 'mdi:open-in-new', fk: 'feat:open:hk_music' })]));
      }
    }
    h_categories(c) {
      var self = this, cats = (this.data.choices || {}).browse_categories || [], hide = this.data.settings.browse.hide || [];
      c.appendChild(K.group({ header: 'Shown', footer: 'The Library categories on the Music page’s Browse side.' }, cats.map(function (k) {
        var on = hide.indexOf(k) < 0;
        return K.check({ label: M.BROWSE_LABELS[k] || k, multi: true, on: on, fk: 'cat:' + k, onClick: function () {
          self.setH({ 'browse.hide': cats.filter(function (y) { return y === k ? on : hide.indexOf(y) >= 0; }) });
        } });
      })));
    }
    h_discover(c) {
      var self = this, rows = this.data.settings.browse.discover || [], shelves = this.data.shelves || {};
      c.appendChild(K.listEditor({ fk: 'disc', shownHeader: 'Shown', emptyText: 'No Discover section', announce: this.announce.bind(this),
        rows: rows.map(function (k) { return { value: k, label: shelves[k] || k }; }),
        more: Object.keys(shelves).filter(function (k) { return rows.indexOf(k) < 0; }).map(function (k) { return { value: k, label: shelves[k] }; }),
        shownFooter: 'A row with nothing in it yet (no favorite albums) isn’t shown.',
        onChange: function (v) { self.setH({ 'browse.discover': v }); } }));
    }
    // ---------------------------------------------------------- wall tablets (1.14)
    // A TABLET is its own item (settings.py SUBENTRY_TABLET), apart from the
    // screen it runs: its user, room, kiosk app, idle and Sleep Screen.
    tabs() { return (this.data && this.data.tablets) || {}; }
    tabIds() {
      var t = this.tabs();
      return Object.keys(t).sort(function (a, b) { return String(t[a].name).localeCompare(String(t[b].name)); });
    }
    setT(tid, changes) {
      var d = this.data, house = (d.settings && d.settings.tablets) || {};
      return this.save({ type: DOMAIN + '/tablet/set', tablet: tid, changes: changes },
        Object.keys(changes).map(function (k) { return 't:' + k; }), function () {
          var t = d.tablets[tid] = Object.assign({}, d.tablets[tid] || {}, changes);
          if ('idle_time' in changes) {
            t.idle_time_own = changes.idle_time;
            if (changes.idle_time === null) t.idle_time = typeof house.idle_time === 'number' ? house.idle_time : 50;
          }
          if ('idle_return' in changes) {
            t.idle_return_own = changes.idle_return;
            if (changes.idle_return === null) t.idle_return = house.idle_return !== false;
          }
        }, function (r) { if (r && r.tablet) d.tablets[tid] = Object.assign({}, d.tablets[tid] || {}, r.tablet); });
    }
    tabletStatusOf(tid) {
      return M.tabletStatus(this.tabs()[tid], this.client.states, (this.data.screensavers || {})[tid]);
    }
    // a time from Home Assistant, as the house reads it: 8:16 PM; another
    // day's with its day
    when(iso) {
      var d = new Date(iso);
      if (!iso || isNaN(d.getTime())) return '';
      var t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      var now = new Date();
      if (d.toDateString() === now.toDateString()) return t;
      var y = new Date(now.getTime() - 86400000);
      return (d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })) + ', ' + t;
    }
    screenTitle(path) { var x = path && this.dash(path); return x ? x.title : (path || 'No Screen'); }
    tabTile(st) { return { off: C.red, dark: C.gray, photos: C.purple, awake: C.green }[st] || C.blue; }
    // press a kiosk app's buttons (the tablets' own Reload, Clear Cache ...):
    // HA's buttons, or the host's own parts (its press). Resolves true, or
    // false once a failure has been said (`what`: "Couldn't Reload")
    press(ids, what) {
      var self = this;
      ids = (ids || []).filter(Boolean);
      if (!ids.length) return Promise.resolve(true);
      var hx = this.host(), go = null;
      if (hx && typeof hx.press === 'function') { try { go = hx.press(ids, this); } catch (e) { go = Promise.reject(e); } }
      if (!go) go = this.actions().callService('button', 'press', { entity_id: ids });
      return Promise.resolve(go).then(function () { return true; }, function (e) {
        var msg = (e && e.message) || String(e || 'It failed.');
        self.announce('Couldn’t: ' + msg);
        K.confirm(self.shadowRoot, { title: 'Couldn’t ' + (what || 'Do That'), message: msg, ok: 'OK', cancel: false });
        return false;
      });
    }
    // THE ACTION PORT (HKClient) of this panel's client: every save, service
    // call, config flow and upload goes through it. A host that cannot act
    // refuses there, sending nothing.
    actions() { return this.client.actions; }
    // AN HTTP WRITE to the host's API (the config flows: start a step,
    // answer it, abandon it), through the action port; see restWrite.
    rest(method, path, body) { return restWrite(this.actions(), method, path, body); }
    // the kiosk apps' Clear Cache, then -- once it has had a moment -- Reload:
    // the way a tablet picks up new HK files (a reload alone keeps them)
    clearAndReload(tids) {
      var self = this, tabs = this.tabs();
      var parts = tids.map(function (t) { return (tabs[t] || {}).parts || {}; });
      return this.press(parts.map(function (p) { return p.clear_cache; }), 'Clear the Cache').then(function (ok) {
        if (!ok) return false;
        return new Promise(function (r) { setTimeout(r, 5000); }).then(function () {
          return self.press(parts.map(function (p) { return p.reload; }), 'Reload');
        });
      });
    }
    h_tablets(c) {
      var self = this, tabs = this.tabs(), ids = this.tabIds(), st = this.client.states;
      var hs = (this.data.settings && this.data.settings.tablets) || {};
      // WHAT MAY BE A TABLET that isn't one (tablets.py suggestions)
      (this.data.tablet_suggest || []).forEach(function (sg) {
        var app = M.tabletApp(sg.app)[1];
        var what = sg.device
          ? 'The ' + app + ' device “' + sg.name + '”' + (sg.ip ? ' (' + sg.ip + ')' : '') + ' isn’t on a wall tablet yet' +
            (sg.screen ? '. It’s showing ' + self.screenTitle(sg.screen) + '.' : '.')
          : app + ' is showing ' + (sg.screen ? self.screenTitle(sg.screen) : 'a screen') + ', signed in as ' + sg.user + '.';
        c.appendChild(K.group({ header: 'This Looks Like a Wall Tablet', footer: what + ' Not a Tablet: it won’t be suggested again.' }, [
          K.button({ label: 'Add Tablet…', fk: 'sug:add:' + sg.key, onClick: function () { self._addFrom = sg; self.go('#/house/tablets/add'); } }),
          K.button({ label: 'Not a Tablet', fk: 'sug:no:' + sg.key, onClick: function () {
            self.data.tablet_suggest = (self.data.tablet_suggest || []).filter(function (x) { return x.key !== sg.key; });
            self.setH({ 'tablets.dismissed': (hs.dismissed || []).concat(sg.key) });
            self.render();
          } })]));
      });
      var rows = ids.map(function (tid) {
        var t = tabs[tid], ts = self.tabletStatusOf(tid);
        var v = !ts.known ? '' : ts.st === 'off' ? 'Offline' : ts.word + (ts.batt !== null ? ' · ' + ts.batt + '%' : '');
        return K.nav({ tile: ['mdi:tablet', ts.known ? self.tabTile(ts.st) : C.blue], label: t.name,
                       sub: self.screenTitle(t.screen) + ' screen · ' + M.tabletApp(t.app)[1], value: v,
                       href: '#/house/tablets/' + encodeURIComponent(tid), fk: 'tab:' + tid });
      });
      rows.push(K.nav({ tile: ['mdi:plus', C.gray], label: 'Add Tablet…', href: '#/house/tablets/add', sk: 'tablet:add' }));
      c.appendChild(K.group({ header: 'Tablets', footer: ids.length
          ? 'Dark: nobody’s in the room, or it’s quiet hours. Each tablet’s page says why, and since when.'
          : 'A wall tablet runs a screen. Its idle time, its screensaver and how it sleeps are its own.' }, rows));
      // THE HOST'S OWN, for the tablets as a whole (extend 'tablets'): nothing in Home Assistant
      var hxs = this.host();
      if (hxs && typeof hxs.extend === 'function') {
        try { hxs.extend('tablets', c, { tablets: tabs }, this); } catch (e) { /* the host's own page */ }
      }
      if (ids.length) {
        var probs = [];
        ids.forEach(function (tid) {
          M.tabletChecks(tabs[tid], st).forEach(function (ch) { if (!ch.ok) probs.push([tid, ch]); });
        });
        c.appendChild(K.group({ footer: 'Each tablet’s kiosk app, checked against what HK needs. They’re in System → Setup Check too.' }, [
          K.nav({ tile: [probs.length ? 'mdi:alert' : 'mdi:check', probs.length ? C.orange : C.green], label: 'Setup Check', sk: 'tablets:check',
                  value: probs.length ? probs.length + ' to look at: ' + tabs[probs[0][0]].name : 'All Set Up Right',
                  href: probs.length ? '#/house/tablets/' + encodeURIComponent(probs[0][0]) : '#/check' })]));
      }
      var it = typeof hs.idle_time === 'number' ? hs.idle_time : 50;
      var saver = M.saverOptions(this.hs('look.saver'));
      c.appendChild(K.group({ header: 'All Tablets', footer: 'A tablet uses these unless its own page sets its own. Untouched this long on any page but Home, it goes back to Home.' }, [
        K.toggle({ label: 'Return to Home When Idle', sk: 'tablets.idle_return', on: hs.idle_return !== false,
                   onChange: function (on) { self.setH({ 'tablets.idle_return': on }); } }),
        K.select({ label: 'Idle Time', sk: 'tablets.idle_time', value: it, disabled: hs.idle_return === false,
                   options: M.IDLE_TIMES.map(function (o) { return [o[0], o[1]]; }),
                   onChange: function (v) { self.setH({ 'tablets.idle_time': Number(v) }); } }),
        K.nav({ label: 'Screensaver', sub: 'What it shows, and when it starts.', value: M.saverSummary(saver),
                href: '#/house/screensaver', sk: 'tablets:saver' })]));
      c.appendChild(K.group({ header: 'Alerts', footer: 'In Home Assistant’s notifications until it’s put right — and, with Notifications added, as an Important banner on the screens.' }, [
        K.toggle({ label: 'Tablet Offline', sub: 'Its kiosk app not heard from for 10 minutes.', sk: 'tablets.alert_offline',
                   on: hs.alert_offline !== false, onChange: function (on) { self.setH({ 'tablets.alert_offline': on }); } }),
        K.toggle({ label: 'Didn’t Come Back After a Restart', sub: 'Not in front 3 minutes after the scheduled restart.', sk: 'tablets.alert_restart',
                   on: hs.alert_restart !== false, onChange: function (on) { self.setH({ 'tablets.alert_restart': on }); } }),
        K.toggle({ label: 'Not Charging', sub: 'Unplugged for 10 minutes.', sk: 'tablets.alert_charging',
                   on: hs.alert_charging !== false, onChange: function (on) { self.setH({ 'tablets.alert_charging': on }); } })]));
      var times = (hs.restart_times || ['00:02', '15:00']);
      var rs = [K.toggle({ label: 'Scheduled Restart', sub: 'Clear the cache, then restart each tablet.', sk: 'tablets.restart', on: !!hs.restart,
                           onChange: function (on) { self.setH({ 'tablets.restart': on }); } })];
      if (hs.restart) {
        rs.push(K.text({ label: 'At', sk: 'tablets.restart_times', value: times.join(', '), placeholder: '00:02, 15:00',
                         error: this.err('tablets.restart_times') ? 'Times like 00:02, 15:00 (up to four).' : null,
                         onCommit: function (v) {
                           self.setH({ 'tablets.restart_times': v.split(/[,\s]+/).filter(Boolean) });
                         } }));
      }
      c.appendChild(K.group({ header: 'Upkeep', footer: 'Every tablet whose kiosk app can restart (Restart Tablet needs Kiosk Satellite as the device owner, else its app restarts). If your own automation already does this, leave it off.' }, rs));
      var withReload = ids.filter(function (tid) { return (tabs[tid].parts || {}).reload; });
      c.appendChild(K.group({ header: 'All at Once', footer: 'After updating ' + PN() + ', Clear Cache & Reload: a plain reload keeps the old HK files.' }, [
        K.button({ label: 'Reload All', fk: 'tablets:reload', disabled: !withReload.length, onClick: function () {
          var p = withReload.map(function (tid) { return tabs[tid].parts.reload; });
          self.press(p, 'Reload').then(function (ok) { if (ok) self.announce('Reloading ' + p.length + (p.length === 1 ? ' tablet' : ' tablets')); });
        } }),
        K.button({ label: 'Clear Cache & Reload All', fk: 'tablets:clear', disabled: !withReload.length, onClick: function () {
          self.announce('Clearing the cache, then reloading. Each takes up to a minute.');
          self.clearAndReload(withReload);
        } })]));
    }
    // ONE TABLET'S PAGE: how it's doing, when it's left alone, its idle,
    // setup, checks and actions
    t_one(c, tid) {
      var self = this, t = this.tabs()[tid];
      if (!t) { c.appendChild(K.group({ footer: 'There is no such tablet. It may have been removed.' }, [])); return; }
      var client = this.client, st = client.states, p = t.parts || {}, base = '#/house/tablets/' + encodeURIComponent(tid);
      var ts = this.tabletStatusOf(tid), ids = (this.data.screensavers || {})[tid] || {};
      var house = (this.data.settings && this.data.settings.tablets) || {};
      var set = function (ch) { return self.setT(tid, ch); };
      var val = function (id) { var x = id && st[id]; return x && x.state !== 'unknown' && x.state !== 'unavailable' ? x.state : null; };
      var sl = t.sleep || {}, hk = sl.decided_by === 'hk' || sl.decided_by === 'shadow', acting = sl.decided_by === 'hk';
      // NOW
      var now = [];
      if (ts.known) {
        now.push(K.info({ label: ts.word, sub: ts.why ? ts.why.charAt(0).toUpperCase() + ts.why.slice(1) : null,
                          value: ts.since ? 'Since ' + this.when(ts.since) : '', valueCls: ts.st === 'off' ? 'warn' : '',
                          tile: ['mdi:tablet', this.tabTile(ts.st)] }));
      }
      if (p.battery) {
        now.push(K.info({ label: 'Battery', value: (ts.batt !== null ? ts.batt + '%' : '—') +
                          (ts.charging ? ' · Charging' : ts.charging === false ? ' · Not Charging' : ''),
                          valueCls: ts.charging && ts.batt > 85 ? 'warn' : '' }));
      }
      if (p.brightness && val(p.brightness) !== null) {
        var bv = Number(val(p.brightness));
        now.push(K.info({ label: 'Brightness', value: (t.app === 'fully' ? Math.round(bv / 2.55) : Math.round(bv)) + '%' }));
      }
      if (val(p.touched)) now.push(K.info({ label: 'Last Touched', value: this.when(val(p.touched)) }));
      if (val(p.uptime)) now.push(K.info({ label: 'Running Since', sub: 'Its last restart.', value: this.when(val(p.uptime)) }));
      if (val(p.model) || val(p.version)) {
        now.push(K.info({ label: 'Device', value: [val(p.model), val(p.version) ? M.tabletApp(t.app)[1] + ' ' + val(p.version) : ''].filter(Boolean).join(' · ') }));
      }
      if (now.length) {
        c.appendChild(K.group({ header: 'Now', footer: ids.sleep ? 'Why comes from ' + ids.sleep + ', which automations can read too.' : null }, now));
      }
      // WHEN IT'S LEFT ALONE: Home, the screensaver, dark -- in order
      var b = (this.data.boards || {})[t.screen] || null;
      var saverOn = !!(b && b.screensaver && b.screensaver_engine !== 'wallpanel');
      var so = b ? M.saverOptions(M.saverFollows(b) ? this.hs('look.saver') : b.screensaver_options) : null;
      var tl = M.idleTimeline({ idle: t.idle_return ? t.idle_time : null, saver: saverOn ? so.starts_after : null, hk: hk,
                                after: sl.after_saver, quiet: !!(sl.schedule || (sl.quiet_while || []).length) });
      var tot = tl.segs.reduce(function (n, x) { return n + x.flex; }, 0), at = 0;
      var track = h('div', { class: 'track' }), ticks = h('div', { class: 'ticks' });
      tl.segs.forEach(function (x, i) {
        track.appendChild(h('div', { class: 'seg ' + x.cls, style: 'flex:' + x.flex, text: x.label }));
        if (i) ticks.appendChild(h('span', { style: 'left:' + (at / tot * 100).toFixed(1) + '%' }, [h('b', { text: x.at }), x.says]));
        at += x.flex;
      });
      var tlEl = h('div', { class: 'cell tl', 'data-sk': 't:timeline' }, [track, ticks,
        tl.warn ? h('div', { class: 'tlwarn', text: 'Home comes after the screensaver starts, so the screensaver can come up over another page and it goes Home behind it. An Idle Time shorter than ' + M.idleLabel(so.starts_after).toLowerCase() + ' puts Home first.' }) : null]);
      c.appendChild(K.group({ header: 'When It’s Left Alone', footer: 'Home: Idle Time, below. The screensaver: its screen’s Screensaver Options → Starts After. Dark: Sleep Screen.' }, [tlEl,
        K.nav({ label: 'Sleep Screen', sub: 'When it goes dark, who counts as there, its brightness.', href: base + '/sleep', sk: 't:sleep',
                value: acting ? PN() + ' Decides' : sl.decided_by === 'shadow' ? 'Trying It Out' : 'An Automation Decides' })]));
      // WHEN IDLE: its own, or All Tablets'
      var ownRet = t.idle_return_own, ownIt = t.idle_time_own;
      var hRet = house.idle_return !== false ? 'On' : 'Off', hIt = M.idleLabel(typeof house.idle_time === 'number' ? house.idle_time : 50);
      var idleRows = [
        K.select({ label: 'Return to Home When Idle', sub: ownRet === null || ownRet === undefined ? 'Same as All Tablets' : 'Just This Tablet',
                   sk: 't:idle_return', value: ownRet === null || ownRet === undefined ? '' : ownRet ? 'on' : 'off',
                   options: [['', 'Same as All Tablets (' + hRet + ')', hRet], ['on', 'On'], ['off', 'Off']],
                   onChange: function (v) { set({ idle_return: v === '' ? null : v === 'on' }); } })];
      if (t.idle_return) {
        idleRows.push(K.select({ label: 'Idle Time', sub: ownIt === null || ownIt === undefined ? 'Same as All Tablets' : 'Just This Tablet',
          sk: 't:idle_time', value: ownIt === null || ownIt === undefined ? '' : ownIt,
          options: [['', 'Same as All Tablets (' + hIt + ')', hIt]].concat(M.IDLE_TIMES.map(function (o) { return [o[0], o[1]]; })),
          onChange: function (v) { set({ idle_time: v === '' ? null : Number(v) }); } }));
      }
      if (b && b.screensaver) {
        idleRows.push(K.nav({ label: 'Screensaver Options', sub: 'The ' + this.screenTitle(t.screen) + ' screen’s: what it shows here.',
          href: '#/screens/' + encodeURIComponent(t.screen) + (b.screensaver_engine === 'wallpanel' ? '/wallpanel' : '/screensaver'),
          value: M.saverFollows(b) ? 'Same as All Screens' : 'Just This Screen', sk: 't:saver' }));
      } else if (t.screen) {
        idleRows.push(K.nav({ label: 'Photo Screensaver', sub: 'Off on the ' + this.screenTitle(t.screen) + ' screen.', value: 'Off',
                              href: '#/screens/' + encodeURIComponent(t.screen), sk: 't:saver' }));
      }
      c.appendChild(K.group({ header: 'When Idle' }, idleRows));
      // SETUP
      var dashes = (this.data.dashboards || []).filter(function (x) { return x.item || x.path === t.screen; });
      var users = (this.data.users || []).slice();
      if (t.user && users.indexOf(t.user) < 0) users.push(t.user);
      var devArea = t.device && client.devices && client.devices[t.device] ? client.devices[t.device].area_id : '';
      var hostOwn = (this.host() && this.host().owns) || {};
      var setup = [
        K.text({ label: 'Name', sk: 't:name', value: t.name, error: this.err('t:name') ? 'Give it a name.' : null,
                 onCommit: function (v) { if (v.trim()) set({ name: v.trim() }); } }),
        K.select({ label: 'Screen', sub: 'What it shows. A screen can run on several tablets.', sk: 't:screen', value: t.screen || '',
                   options: [['', 'None']].concat(dashes.map(function (x) { return [x.path, x.title]; })),
                   onChange: function (v) { set({ screen: v }); } }),
        K.select({ label: 'Room', sk: 't:room', value: t.room || '',
                   sub: devArea && devArea !== t.room ? 'Its kiosk device is in ' + this.areaName(devArea) + ' in Home Assistant.' : 'Calm When Nobody’s Around looks here.',
                   options: [['', 'None']].concat(this.areasAZ().map(function (a) { return [a, self.areaName(a)]; })),
                   onChange: function (v) { set({ room: v }); } }),
        hostOwn.tablet_user ? null : K.select({ label: 'Tablet User', sub: 'The person it signs in as. Its own is best.', sk: 't:user', value: t.user || '',
                   options: [['', 'None']].concat(users.map(function (u) { return [u, u]; })),
                   onChange: function (v) { set({ user: v }); } }),
        K.select({ label: 'Kiosk App', sk: 't:app', value: t.app, options: M.TABLET_APPS.map(function (a) { return [a[0], a[1]]; }),
                   onChange: function (v) { set(v === 'kiosk_satellite' || v === 'fully' ? { app: v } : { app: v, device: '' }); } })];
      if (t.app === 'kiosk_satellite' || t.app === 'fully') {
        var devs = (this.data.kiosk_devices || []).filter(function (d) { return d.app === t.app; });
        setup.push(K.select({ label: 'Device', sk: 't:device', value: t.device || '', placeholder: 'Choose…',
                              options: [['', 'None']].concat(devs.map(function (d) { return [d.id, d.name]; })),
                              onChange: function (v) { set({ device: v }); } }));
      }
      var url = M.tabletUrl(location.origin, t.screen, tid);
      setup.push(K.button({ label: 'Copy Start URL', fk: 't:url', onClick: function () { self.copyText(url); } }));
      c.appendChild(K.group({ header: 'Setup', footer: h('span', {}, [
        'Its start URL, for the kiosk app’s start page: ', h('span', { class: 'url', text: url }),
        '. It tells the page which tablet it is, even when two tablets share a user or a screen.']) }, setup));
      // THE HOST'S OWN, for this tablet (extend, above): nothing in Home Assistant
      var hx = this.host();
      if (hx && typeof hx.extend === 'function') {
        try { hx.extend('tablet', c, { tablet: tid, name: t.name, app: t.app }, this); } catch (e) { /* the host's own page */ }
      }
      // SETUP CHECK, with Fix where HK can set it right
      var checks = M.tabletChecks(t, st);
      if (checks.length) {
        var cr = [];
        checks.forEach(function (ch) {
          cr.push(K.info({ icon: ch.ok ? 'mdi:check-circle' : 'mdi:alert-circle', label: ch.title, sub: ch.detail || null,
                           value: ch.ok ? 'OK' : 'To Fix', valueCls: ch.ok ? 'ok' : 'warn' }));
          if (!ch.ok && ch.fix) {
            cr.push(K.button({ label: 'Fix: ' + ch.title, fk: 't:fix:' + ch.key, onClick: function () {
              var go = ch.fix[0] === 'hk'
                ? self.actions().callWS({ type: DOMAIN + '/tablet/act', tablet: tid, act: 'kiosk_saver' })
                : self.actions().callService(ch.fix[0], ch.fix[1], ch.fix[2]);
              Promise.resolve(go).then(function () { self.announce('Done: ' + ch.title); setTimeout(function () { self.render(true); }, 1500); },
                                       function (e) { self.announce('Couldn’t: ' + ((e && e.message) || e)); });
            } }));
          }
        });
        c.appendChild(K.group({ header: 'Setup Check', footer: 'Fix sets the kiosk app’s own setting from here. Protect Battery is set on the tablet itself.' }, cr));
      }
      // ACTIONS: what its kiosk app (and Sleep Screen) can do
      var act = [];
      var ask = function (what) {
        return self.actions().callWS({ type: DOMAIN + '/tablet/act', tablet: tid, act: what }).then(function () {
          self.announce(what === 'wake' ? t.name + ' is waking' : t.name + ' is going dark');
        }, function (e) { self.announce('Couldn’t: ' + ((e && e.message) || e)); });
      };
      if (acting) {
        act.push(K.button({ label: 'Wake Now', fk: 't:wake', onClick: function () { ask('wake'); } }));
        act.push(K.button({ label: 'Sleep Now', fk: 't:sleepnow', onClick: function () { ask('sleep'); } }));
      }
      if (p.reload) act.push(K.button({ label: 'Reload', fk: 't:reload', onClick: function () { self.press([p.reload], 'Reload').then(function (ok) { if (ok) self.announce('Reloading ' + t.name); }); } }));
      if (p.reload && p.clear_cache) act.push(K.button({ label: 'Clear Cache & Reload', fk: 't:clear', onClick: function () { self.announce('Clearing the cache, then reloading'); self.clearAndReload([tid]); } }));
      if (p.restart_app) act.push(K.button({ label: 'Restart App', fk: 't:restartapp', onClick: function () { self.press([p.restart_app], 'Restart the App').then(function (ok) { if (ok) self.announce('Restarting the app'); }); } }));
      if (p.restart_device) {
        act.push(K.button({ label: 'Restart Tablet…', destructive: true, fk: 't:restart', onClick: function () {
          K.confirm(self.shadowRoot, { title: 'Restart ' + t.name + '?', message: 'The tablet restarts and comes back to its screen in about a minute.',
                                       ok: 'Restart', destructive: true }).then(function (yes) {
            if (yes) self.press([p.restart_device], 'Restart the Tablet').then(function (ok) { if (ok) self.announce('Restarting ' + t.name); });
          });
        } }));
      }
      if (act.length) {
        c.appendChild(K.group({ header: 'Actions', footer: acting ? 'Wake Now and Sleep Now: Sleep Screen decides again after — somebody in the room wakes it.' : null }, act));
      }
      if (hk && this.tabIds().length > 1) {
        c.appendChild(K.group({}, [K.nav({ label: 'Copy Sleep Screen To…', sub: 'Its rules and brightness, onto other tablets.', href: base + '/copy', sk: 't:copy' })]));
      }
      c.appendChild(K.group({ footer: 'Its screen and its kiosk app stay. Its own entities go.' }, [
        K.button({ label: 'Remove Tablet…', destructive: true, fk: 't:remove', onClick: function () {
          K.confirm(self.shadowRoot, { title: 'Remove ' + t.name + '?', message: 'Its idle, screensaver and Sleep Screen settings and its own entities go. Its screen and its kiosk app stay.',
                                       ok: 'Remove', destructive: true }).then(function (yes) {
            if (!yes) return;
            self.ws({ type: DOMAIN + '/tablet/remove', tablet: tid }).then(function (ok) {
              if (ok) self.reload().then(function () { self.go('#/house/tablets'); });
            });
          });
        } })]));
    }
    copyText(text) {
      var self = this;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { self.announce('Copied'); }, function () { self.announce(text); });
      } else self.announce(text);
    }
    // ADD TABLET: its name, screen, room, kiosk app (and device) and user
    t_add(c) {
      var self = this, sg = this._addFrom || null;
      var n = this._newT = this._newT || {
        name: sg && sg.name ? sg.name.replace(/\s*Kiosk\s*$/i, '') : '', screen: (sg && sg.screen) || this._addScreen || '',
        room: '', user: (sg && sg.user) || '', app: (sg && sg.app) || 'kiosk_satellite', device: (sg && sg.device) || ''
      };
      this._addFrom = null; this._addScreen = null;
      var redraw = function () { self.render(); };
      var dashes = (this.data.dashboards || []).filter(function (x) { return x.item; });
      var used = {};
      Object.keys(this.tabs()).forEach(function (k) { if (self.tabs()[k].device) used[self.tabs()[k].device] = true; });
      var rows = [
        K.text({ label: 'Name', sk: 'new:name', value: n.name, placeholder: 'Garage', onCommit: function (v) { n.name = v.trim(); redraw(); } }),
        K.select({ label: 'Screen', sk: 'new:screen', value: n.screen, options: [['', 'None']].concat(dashes.map(function (x) { return [x.path, x.title]; })),
                   onChange: function (v) { n.screen = v; } }),
        K.select({ label: 'Room', sk: 'new:room', value: n.room, options: [['', 'None']].concat(this.areasAZ().map(function (a) { return [a, self.areaName(a)]; })),
                   onChange: function (v) { n.room = v; } })];
      c.appendChild(K.group({}, rows));
      var app = [K.select({ label: 'Kiosk App', sk: 'new:app', value: n.app, options: M.TABLET_APPS.map(function (a) { return [a[0], a[1]]; }),
                            onChange: function (v) { n.app = v; n.device = ''; redraw(); } })];
      if (n.app === 'kiosk_satellite' || n.app === 'fully') {
        var devs = (this.data.kiosk_devices || []).filter(function (d) { return d.app === n.app; });
        devs.sort(function (a, b) { return (used[a.id] ? 1 : 0) - (used[b.id] ? 1 : 0); });
        app.push(K.select({ label: 'Device', sk: 'new:device', value: n.device, placeholder: 'Choose…',
                            options: [['', 'Choose…']].concat(devs.map(function (d) { return [d.id, d.name + (used[d.id] ? ' (on a tablet)' : '')]; })),
                            onChange: function (v) { n.device = v; } }));
      }
      c.appendChild(K.group({ header: 'Kiosk App', footer: M.tabletApp(n.app)[2] + (n.app === 'browser' ? ' Choose this for a screen HK can’t see a kiosk app on: an old iPad, or a car.' : '') }, app));
      var users = (this.data.users || []).slice();
      c.appendChild(K.group({ header: 'Signs In As', footer: 'Best: a person of its own in Home Assistant (Settings → People → Add Person, with a login), so it gets its own music room and screensaver, and nobody’s phone counts as it.' }, [
        K.select({ label: 'Tablet User', sk: 'new:user', value: n.user, options: [['', 'None']].concat(users.map(function (u) { return [u, u]; })),
                   onChange: function (v) { n.user = v; } }),
        K.nav({ label: 'Add a Person in Home Assistant', icon: 'mdi:open-in-new', href: '/config/person', sk: 'new:person' })]));
      c.appendChild(K.group({ footer: 'Its page then has its start URL to put in the kiosk app.' }, [
        K.button({ label: 'Add Tablet', fk: 'new:add', disabled: !n.name, onClick: function () {
          var got = null;
          self.save({ type: DOMAIN + '/tablet/add', tablet: { name: n.name, screen: n.screen, room: n.room, user: n.user, app: n.app, device: n.device } },
                    ['t:name'], function () {}, function (r) { got = r; }).then(function (ok) {
            if (!ok || !got || !got.id) return;
            self._newT = null;
            self.reload().then(function () { self.go('#/house/tablets/' + encodeURIComponent(got.id)); });
          });
        } })]));
    }
    // COPY SLEEP SCREEN onto other tablets: its rules, Black Screen and
    // brightness (each keeps its own kiosk)
    t_copySleep(c, tid) {
      var self = this, tabs = this.tabs(), src = tabs[tid];
      var pick = this._copyT = this._copyT && this._copyT.from === tid ? this._copyT : { from: tid, to: [] };
      var others = this.tabIds().filter(function (x) { return x !== tid; });
      c.appendChild(K.group({ header: 'Copy To', footer: 'Presence, Only While Lit and the other lists are copied as they are: change each room’s own sensors afterwards.' },
        others.map(function (x) {
          var on = pick.to.indexOf(x) >= 0;
          return K.check({ label: tabs[x].name, multi: true, on: on, fk: 'copyt:' + x, onClick: function () {
            if (on) pick.to = pick.to.filter(function (y) { return y !== x; }); else pick.to.push(x);
            self.render();
          } });
        })));
      c.appendChild(K.group({}, [K.button({ label: pick.to.length ? 'Copy to ' + pick.to.length + (pick.to.length === 1 ? ' Tablet' : ' Tablets') : 'Copy',
        fk: 'copyt:go', disabled: !pick.to.length, onClick: function () {
          Promise.all(pick.to.map(function (x) {
            return self.setT(x, { sleep: JSON.parse(JSON.stringify(src.sleep || {})), black_screen: src.black_screen || 'kiosk' });
          })).then(function () { self._copyT = null; self.announce('Copied'); self.go('#/house/tablets/' + encodeURIComponent(tid)); });
        } })]));
    }

    // ---------------------------------------------------------- accessories
    accIds() {
      var self = this, client = this.client, ents = client.entities || {}, acc = (this.data.accessories || {}).entities || {};
      var chipIds = {};
      Object.keys(this.data.boards || {}).forEach(function (p) {
        ((self.data.boards[p] || {}).chips_extra || []).forEach(function (id) { chipIds[id] = true; });
      });
      return Object.keys(client.states).filter(function (id) {
        var e = ents[id] || {};
        if (acc[id] || chipIds[id]) return true;
        if (!TILE_DOMAINS.test(id) || e.hidden || e.entity_category) return false;
        return !!self.areaOf(id) || id.indexOf('timer.') === 0;
      });
    }
    p_accessories(sub) {
      var self = this, back = ['Accessories', '#/accessories'];
      if (sub[0] !== 'hidden') this._hr = null;          // Just Now: until the list is left
      // HIDDEN ACCESSORIES (hiding.py): the list, Hide Accessories (pick, then
      // where), and one accessory's or device's own Hide From
      if (sub[0] === 'hidden') {
        var hb = ['Hidden Accessories', '#/accessories/hidden'];
        if (sub[1] !== undefined && sub[1] !== 'edit' && sub[1] !== 'device') this._hr = null;
        if (sub[1] === 'pick') return { title: 'Hide Accessories', back: hb, body: function (c) { self.a_hidePick(c); } };
        if (sub[1] === 'where') return { title: 'Hide From', back: ['Hide Accessories', '#/accessories/hidden/pick'], body: function (c) { self.a_hideWhere(c, null); } };
        if (sub[1] === 'edit' && sub[2]) return { title: 'Hide From', back: hb, scope: K.esc(this.name(sub[2])) + ' · ' + K.esc(sub[2]),
                                                  body: function (c) { self.a_hideWhere(c, sub[2]); } };
        if (sub[1] === 'kind' && sub[2]) return { title: this.placeName(sub[2]), back: hb, scope: 'Hidden from ' + K.esc(this.placeName(sub[2])) + '.',
                                                  body: function (c) { self.a_hideKind(c, sub[2]); } };
        if (sub[1] === 'device' && sub[2]) return { title: this.devName(sub[2]), back: hb, body: function (c) { self.a_hideDevice(c, sub[2]); } };
        return { title: 'Hidden Accessories', back: back, scope: 'Each one stays in Home Assistant. Hidden everywhere, or just from the places listed.',
                 body: function (c) { self.a_hidden(c); } };
      }
      // ADDED ACCESSORIES (was Also Shown, 2026-10-13): tiles for what HK
      // wouldn't show by itself -- generated.include_entities
      if (sub[0] === 'added' || sub[0] === 'also') return { title: 'Added Accessories', back: back,
        scope: 'Tiles for things HK doesn’t show by itself — a script, a scene, a sensor. Hidden Accessories is the other way.',
        body: function (c) { self.a_also(c); } };
      // A TYPE (2026-10-13): what it lists, what its page and chip count, its
      // order -- What Counts' kind pages, folded in
      if (sub[0] === 'type' && M.accType(sub[1])) {
        var T = M.accType(sub[1]), tb = [T[1], '#/accessories/type/' + sub[1]];
        if (sub[2] === 'order' && T[4].order) return { title: 'Tile Order', back: tb, scope: this.orderScope(T[4].order),
                                                       body: function (c) { self.a_pageOrder(c, T[4].order); } };
        return { title: T[1], back: back, scope: K.esc(this.typeSays(T)), body: function (c) { self.a_type(c, T); } };
      }
      if (sub[0] === 'page' && PAGE_ORDERS[sub[1]]) return { title: 'Tile Order', back: back, scope: this.orderScope(sub[1]),
                                                             body: function (c) { self.a_pageOrder(c, sub[1]); } };
      if (sub[0] === 'room' && sub[1]) {
        var nm = sub[1] === '-' ? 'No Room' : sub[1] === '~timers' ? 'Timers' : this.areaName(sub[1]);
        if (sub[2] === 'order') return { title: 'Tile Order', back: [nm, '#/accessories/room/' + encodeURIComponent(sub[1])], body: function (c) { self.a_roomOrder(c, sub[1]); } };
        if (sub[2] === 'scenes') return { title: 'Scenes', back: [nm, '#/accessories/room/' + encodeURIComponent(sub[1])], body: function (c) { self.a_roomScenes(c, sub[1]); } };
        return { title: nm, back: back, body: function (c) { self.a_room(c, sub[1]); } };
      }
      if (sub[0]) {
        var id = sub[0], a = this.areaOf(id);
        return { title: this.name(id), back: a ? [this.areaName(a), '#/accessories/room/' + encodeURIComponent(a)] : back,
          scope: K.esc((a ? this.areaName(a) + ' · ' : '') + id) + ' · the same on every screen',
          body: function (c) { self.a_one(c, id); } };
      }
      return { title: 'Accessories', top: true, scope: 'How each accessory shows on every screen: its name, room, icon and where it appears. Home Assistant’s own names are untouched.',
               body: function (c) { self.a_root(c); } };
    }
    // ACCESSORIES, laid out by type and then by room (2026-10-13). A type's
    // number is what its page and chip count (a kind's `found`), or how
    // many of its domain HK shows.
    typeMembers(T) {
      var self = this, o = T[4], client = this.client;
      if (o.energy) return [];
      if (o.kind) {
        var ck = (this.data.counts || {})[o.kind] || {}, H = this.hid(), seen = {}, out = [];
        var add = function (id) { if (!seen[id] && client.states[id]) { seen[id] = 1; out.push(id); } };
        (ck.found || []).forEach(add);
        (ck.exclude || []).forEach(add);
        return out;
      }
      return this.accIds().filter(function (id) {
        if (o.domains.indexOf(id.split('.')[0]) < 0 || self.hiddenAll(id)) return false;
        return !o.dc || o.dc.indexOf(((client.states[id] || {}).attributes || {}).device_class) >= 0;
      });
    }
    // hidden everywhere (by itself, its device or its room): one row on a
    // type's page, not a row each in its room -- the old duplicates a house
    // hides would crowd every room
    hiddenAll(id) { return /^(Everywhere|With Its)/.test(this.hideText(id)); }
    typeHidden(T) {
      var self = this, o = T[4], H = this.hid(), client = this.client;
      if (o.energy) return [];
      if (o.kind) return H.everywhere.filter(function (id) { return client.states[id] && (H.can[id] || []).indexOf(o.kind) >= 0; });
      return this.accIds().filter(function (id) {
        if (o.domains.indexOf(id.split('.')[0]) < 0 || !self.hiddenAll(id)) return false;
        return !o.dc || o.dc.indexOf(((client.states[id] || {}).attributes || {}).device_class) >= 0;
      });
    }
    typeCount(T) {
      if (T[4].kind) return (((this.data.counts || {})[T[4].kind] || {}).found || []).filter(function (id) { return this.client.states[id]; }, this).length;
      return this.typeMembers(T).length;
    }
    typeSays(T) {
      if (T[5]) return T[5];
      var k = M.COUNT_KINDS.filter(function (x) { return x[0] === T[4].kind; })[0];
      return k ? k[2] : '';
    }
    orderScope(page) {
      return page === 'security' ? 'The locks and garage doors on the Security page, on every screen.' : 'The vacuums on the Vacuums page, on every screen.';
    }
    // the type an accessory's tile is, for a room's list
    typeOf(id) {
      var dom = id.split('.')[0], dc = ((this.client.states[id] || {}).attributes || {}).device_class;
      if (dom === 'binary_sensor') return { door: 'doors', window: 'windows', garage_door: 'garage', smoke: 'smoke', carbon_monoxide: 'smoke',
                                            moisture: 'leaks', motion: 'motion', moving: 'motion', occupancy: 'occupancy', presence: 'occupancy' }[dc] || null;
      if (dom === 'sensor') return dc === 'temperature' || dc === 'humidity' ? dc : null;
      if (dom === 'cover') return dc === 'garage' || dc === 'gate' ? 'garage' : 'blinds';
      if (dom === 'media_player') return dc === 'tv' || dc === 'receiver' ? 'tvs' : 'speakers';
      return { light: 'lights', switch: 'switches', input_boolean: 'switches', fan: 'fans', climate: 'thermostats', humidifier: 'humidifiers',
               water_heater: 'water_heaters', lock: 'locks', alarm_control_panel: 'alarm', vacuum: 'vacuums', valve: 'valves',
               timer: 'timers', camera: 'cameras' }[dom] || null;
    }
    a_root(c) {
      var self = this, client = this.client, areas = client.areas || {}, g = this.data.settings.generated;
      var acc = (this.data.accessories || {}).entities || {};
      var ids = this.accIds();
      var sb = h('div', { class: 'search', style: 'margin:0 0 22px' });
      sb.appendChild(K.icon('mdi:magnify', 'mag'));
      var inp = h('input', { type: 'search', placeholder: 'Search Accessories', 'aria-label': 'Search accessories', 'data-fk': 'acc:search' });
      inp.value = this._aq || '';
      sb.appendChild(inp);
      c.appendChild(sb);
      var box = h('div');
      c.appendChild(box);
      var paint = function () {
        box.innerHTML = '';
        var q = inp.value.trim().toLowerCase();
        if (q) {
          // SEARCH FINDS MORE THAN THE TILES: a sensor a chip could also count
          // (a camera's smoke alarm, a temperature sensor) has its page too --
          // that is where Also Count As is
          var pool = ids.slice(), seen = {};
          ids.forEach(function (id) { seen[id] = 1; });
          var also = {};
          Object.keys(self.data.counts || {}).forEach(function (k) { (self.data.counts[k].also || []).forEach(function (d) { also[d] = 1; }); });
          self.entityIds({ domains: Object.keys(also), shown: true }).forEach(function (id) { if (!seen[id]) { seen[id] = 1; pool.push(id); } });
          var got = pool.filter(function (id) {
            return (self.name(id) + ' ' + id + ' ' + self.areaName(self.areaOf(id))).toLowerCase().indexOf(q) >= 0;
          }).sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); }).slice(0, 200);
          box.appendChild(K.group({ header: 'Accessories', footer: got.length ? null : 'No accessories match.' }, got.map(function (id) {
            // the entity id beside its room: two "Water Heater"s (its climate
            // and its water_heater entity) are told apart without opening each
            return K.nav({ label: self.name(id), sub: (self.areaName(self.areaOf(id)) || 'No room') + ' · ' + id, href: '#/accessories/' + encodeURIComponent(id),
                           icon: self.accGlyph(id), value: self.hideText(id) ? 'Hidden' : acc[id] ? 'Customized' : '' });
          })));
          return;
        }
        var energyOn = F.stateOf(self.data.features, 'hk_energy') === 'added';
        var typeRow = function (T) {
          var n = T[4].energy ? null : self.typeCount(T);
          if (n === 0 && !(T[4].energy && energyOn)) return null;
          if (T[4].energy && !energyOn) return null;
          return K.nav({ label: T[1], tile: [T[2], T[3]], value: n === null ? '' : String(n), href: '#/accessories/type/' + T[0], fk: 'acctype:' + T[0] });
        };
        var kinds = M.ACC_TYPES.filter(function (T) { return !T[6]; }).map(typeRow).filter(Boolean);
        var sensors = M.ACC_TYPES.filter(function (T) { return T[6]; }).map(typeRow).filter(Boolean);
        box.appendChild(K.group({ header: 'Types', footer: 'Each type, room by room: what its page and chip count, and what’s hidden from them or added to them. Cameras and the Energy page’s circuits are accessories too.' }, kinds));
        if (sensors.length) box.appendChild(K.group({ header: 'Sensors', footer: 'What the chips and status rows count: the doors left open, the rooms with motion, the Climate page’s temperatures.' }, sensors));
        var count = {};
        ids.forEach(function (id) { var a = self.areaOf(id) || (id.indexOf('timer.') === 0 ? '~timers' : '-'); count[a] = (count[a] || 0) + 1; });
        var rows = self.areasAZ().filter(function (a) { return count[a]; }).map(function (a) {
          return K.nav({ label: areas[a].name, icon: areas[a].icon || 'mdi:texture-box', value: String(count[a]),
                         href: '#/accessories/room/' + encodeURIComponent(a) });
        });
        if (count['~timers']) rows.push(K.nav({ label: 'Timers', icon: 'mdi:timer-outline', value: String(count['~timers']), href: '#/accessories/room/~timers' }));
        if (count['-']) rows.push(K.nav({ label: 'No Room', icon: 'mdi:help-circle-outline', value: String(count['-']), href: '#/accessories/room/-' }));
        box.appendChild(K.group({ header: 'Rooms' }, rows));
        var hidden = self.hiddenCount(), added = (g.include_entities || []).length;
        box.appendChild(K.group({ header: 'Hidden & Added', footer: 'Hidden: kept off every screen, or off just some pages and chips — it stays in Home Assistant. Added: a tile for something HK doesn’t show by itself, such as a script or a sensor.' }, [
          K.nav({ label: 'Hidden Accessories', icon: 'mdi:eye-off-outline', value: hidden ? String(hidden) : 'None', href: '#/accessories/hidden', sk: 'generated.exclude' }),
          K.nav({ label: 'Added Accessories', icon: 'mdi:plus-circle-outline', value: added ? String(added) : 'None', href: '#/accessories/added', sk: 'generated.include_entities' })]));
        var lk = self.data.settings.look;
        box.appendChild(K.group({ header: 'Tapping an Accessory', footer: 'Tapping an accessory opens an HK detail sheet. Off: Home Assistant’s own dialog. Either way, locks, the alarm, garage doors and thermostats never change from one tap.' }, [
          K.toggle({ label: 'HK Detail Sheets', sk: 'look.details', on: lk.details !== false,
                     onChange: function (on) { self.setH({ 'look.details': on }); } })]));
      };
      inp.addEventListener('input', function () { self._aq = inp.value; paint(); });
      paint();
    }
    // a list of accessories under their rooms, A to Z (a type's page)
    byRoomGroups(c, ids, row, footer) {
      var self = this, by = {}, rooms = [];
      ids.forEach(function (id) { var r = self.areaName(self.areaOf(id)) || 'No Room'; if (!by[r]) { by[r] = []; rooms.push(r); } by[r].push(id); });
      rooms.sort(function (a, b) { return (a === 'No Room') - (b === 'No Room') || a.localeCompare(b); });
      rooms.forEach(function (r, i) {
        c.appendChild(K.group({ header: r, footer: i === rooms.length - 1 ? footer : null },
          by[r].sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); }).map(row)));
      });
      return rooms.length;
    }
    a_type(c, T) {
      var self = this, o = T[4], H = this.hid();
      if (o.link) c.appendChild(K.group({ footer: o.link[2] }, [K.nav({ label: o.link[0], icon: 'mdi:cog-outline', href: '#/' + o.link[1], fk: 'acctype:link' })]));
      if (o.energy) { this.a_typeEnergy(c); return; }
      var ck = o.kind ? (this.data.counts || {})[o.kind] || { found: [], exclude: [], include: [] } : null;
      var ids = this.typeMembers(T);
      var note = function (id) {
        if (self.hiddenAll(id) || (ck && (ck.exclude || []).indexOf(id) >= 0)) return 'Hidden';
        if (ck && (ck.include || []).indexOf(id) >= 0) return 'Added';
        return '';
      };
      var row = function (id) {
        return K.nav({ label: self.name(id), sub: id, icon: self.accGlyph(id), value: note(id), href: '#/accessories/' + encodeURIComponent(id), fk: 'acc:' + id });
      };
      var pname = o.kind ? this.placeName(o.kind) : '';
      var n = this.byRoomGroups(c, ids, row, ck ? 'Hidden: not counted, and not on ' + pname + '. Added: counted though it isn’t found by itself. Tap one for its settings — Where It Shows and Also Count As.'
                                                : 'Tap one for its name, icon, room and Where It Shows.');
      if (!n) c.appendChild(K.group({ footer: ck ? 'HK finds none in this house. Add one below — a group helper, say.' : 'None in this house.' }, []));
      if (ck) c.appendChild(K.group({ header: 'Added', footer: 'Count something more as one of these — an outlet with a lamp, a group helper. It joins its room above, marked Added.' }, [this.countAdd(o.kind, ck)]));
      // ITS CHIP (2026-10-13): which chips count this type, and on which
      // screens -- each a tap from Always / When Active for every screen
      if (o.kind) {
        var crow = this.chipsOfType(o.kind).map(function (ch) {
          return K.nav({ label: (M.CHIP_LABELS[ch] || ch) + ' Chip', sub: self.chipSays(self.chipScreens(ch)), href: '#/house/chips/' + ch, sk: 'acctype:chip:' + ch });
        });
        if (o.kind === 'smoke') crow.push(K.info({ label: 'Smoke & CO Chip', sub: 'Leads every screen’s chip row, in red, when one goes off' }));
        if (crow.length) c.appendChild(K.group({ header: 'Chips', footer: 'Which screens show it, and Always or When Active, for every screen at once.' }, crow));
      }
      var every = this.typeHidden(T), hid = [];
      if (every.length) hid.push(K.nav({ label: 'Hidden Everywhere', icon: 'mdi:eye-off-outline', value: String(every.length), href: '#/accessories/hidden', fk: 'acctype:hidden' }));
      if (ck && (ck.exclude || []).length) hid.push(K.nav({ label: 'Show All on ' + pname + ' Again…', icon: 'mdi:eye-outline', href: '#/accessories/hidden/kind/' + o.kind, fk: 'count:showall' }));
      if (hid.length) c.appendChild(K.group({ header: 'Hidden', footer: (every.length ? 'Hidden everywhere: on no screen at all — they’re listed in Hidden Accessories. ' : '') +
          (ck && ck.exclude.length ? ck.exclude.length + ' above are hidden from ' + pname + ' only; Show All Again brings them back there.' : '') }, hid));
      if (o.order) {
        var po = ((this.data.accessories || {}).pages || {})[o.order] || [];
        c.appendChild(K.group({ header: 'Order', footer: 'The order of the ' + PAGE_ORDERS[o.order][0] + ' page’s tiles, on every screen.' }, [
          K.nav({ label: 'Tile Order', sub: 'On the ' + PAGE_ORDERS[o.order][0] + ' page', value: po.length ? 'Custom' : 'Automatic',
                  href: '#/page/' + o.order + '/order', sk: 'accessories.pages.' + o.order })]));
      }
    }
    // CIRCUITS & METERS: the Energy page's devices (hk_energy's own
    // settings) -- listed here, set up in Energy
    a_typeEnergy(c) {
      var self = this;
      if (F.stateOf(this.data.features, 'hk_energy') !== 'added') {
        c.appendChild(K.group({ footer: 'Energy isn’t added yet. It builds an Energy page with a live tile for each circuit, from Home Assistant’s Energy settings.' }, [
          K.nav({ label: 'Energy', icon: 'mdi:lightning-bolt', href: '#/page/energy' })]));
        return;
      }
      var st = this.feat('hk_energy'), d = st.data || {};
      var devs = d.devices || [];
      c.appendChild(K.group({ footer: 'Their names, glyphs, sections and sensors are set in Energy, with the rest of the Energy page.' }, [
        K.nav({ label: 'Energy Devices', icon: 'mdi:cog-outline', value: st.data ? String(devs.length) : '', href: '#/features/energy/devices', fk: 'acctype:link' }),
        K.nav({ label: 'Energy Page', icon: 'mdi:lightning-bolt', href: '#/page/energy' })]));
      if (!st.data) { c.appendChild(K.group({ footer: st.error ? 'Energy’s settings couldn’t load: ' + st.error : 'Loading…' }, [])); return; }
      var byKey = {};
      devs.forEach(function (x) { byKey[x.key] = x; });
      (d.sections || []).forEach(function (s) {
        var rows = s.items.filter(function (k) { return byKey[k]; }).map(function (k) {
          var x = byKey[k];
          return K.nav({ label: x.name, sub: x.hidden ? 'Hidden' : (x.power ? self.name(x.power) : 'No power sensor'), icon: x.icon,
                         href: '#/features/energy/devices/' + encodeURIComponent(k), fk: 'energy:dev:' + k });
        });
        if (rows.length) c.appendChild(K.group({ header: s.name }, rows));
      });
    }
    a_room(c, aid) {
      var self = this, client = this.client, areas = client.areas || {}, acc = (this.data.accessories || {}).entities || {};
      var ids = this.accIds().filter(function (id) {
        var a = self.areaOf(id);
        return aid === '-' ? !a && id.indexOf('timer.') !== 0 : aid === '~timers' ? !a && id.indexOf('timer.') === 0 : a === aid;
      }).sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); });
      if (areas[aid]) {
        // the room's own settings live in Rooms (All Screens), one place
        c.appendChild(K.group({ footer: 'Its scenes, tile order, whether it shows and what it’s part of.' }, [
          K.nav({ label: 'Room Settings', href: '#/house/rooms/' + encodeURIComponent(aid), icon: 'mdi:sofa', sk: 'room:settings:' + aid })]));
      }
      // BY TYPE, as Accessories is by type and then by room: a room's page is
      // the other way round
      var by = {}, other = [];
      ids.forEach(function (id) { var t = self.typeOf(id); if (t) (by[t] = by[t] || []).push(id); else other.push(id); });
      var row = function (id) {
        var a = acc[id] || {};
        return K.nav({ label: self.name(id), sub: id, icon: self.accGlyph(id),
                       value: self.hideText(id) ? 'Hidden' : Object.keys(a).length ? 'Customized' : '', href: '#/accessories/' + encodeURIComponent(id) });
      };
      M.ACC_TYPES.forEach(function (T) { if (by[T[0]]) c.appendChild(K.group({ header: T[1] }, by[T[0]].map(row))); });
      if (other.length) c.appendChild(K.group({ header: 'Other' }, other.map(row)));
    }
    // A ROOM'S SCENES ROW on its page (accessories.py `scenes`): Automatic --
    // the Home Assistant scenes in the room -- or its own list, where an
    // empty one is no row at all (a room that uses no scenes).
    roomScenesAuto(aid) {
      var self = this;
      return this.entityIds({ domains: ['scene'], shown: true }).filter(function (id) { return self.areaOf(id) === aid; })
        .sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); });
    }
    roomScenesLabel(aid) {
      var own = (((this.data.accessories || {}).scenes || {})[aid]);
      if (!Array.isArray(own)) return this.roomScenesAuto(aid).length ? 'Automatic' : 'None';
      return own.length ? String(own.length) : 'None';
    }
    a_roomScenes(c, aid) {
      var self = this, own = (((this.data.accessories || {}).scenes || {})[aid]);
      var auto = !Array.isArray(own), autoIds = this.roomScenesAuto(aid), cur = auto ? autoIds : own;
      var save = function (v) { self.ws({ type: DOMAIN + '/accessory/room_scenes', area_id: aid, entities: v }); };
      var row = function (id) { return { value: id, label: self.name(id), sub: self.client.states[id] ? id : id + ' (missing)' }; };
      c.appendChild(K.listEditor({ fk: 'rs', auto: auto, announce: this.announce.bind(this), shownHeader: 'Scenes',
        autoFooter: 'Automatic: the Home Assistant scenes in this room, A to Z' + (autoIds.length ? '.' : ' — it has none, so there’s no row.'),
        emptyText: auto ? 'No scenes in this room' : 'No scenes row',
        rows: cur.map(row),
        onAuto: function (on) { save(on ? null : autoIds.slice()); },
        onChange: save,
        addLabel: auto ? null : 'Add Scene or Shortcut…', onAddOther: function () {
          self.go(self.picker('room-scene-add', { title: 'Add Scene or Shortcut', value: null, multi: true,
            items: function () {
              return self.entityIds({ re: SCENE_POOL, shown: true }).filter(function (id) { return cur.indexOf(id) < 0; })
                .map(function (id) { return { value: id, label: self.name(id), sub: self.areaName(self.areaOf(id)) || id }; });
            },
            onPick: function (v) { if (v) save(cur.concat(v)); } }));
        } }));
      c.appendChild(K.group({ footer: 'A row of scene pills on this room’s page, under its status and cameras, on every generated screen. ' +
        'Turn Automatic off and remove them all for a room with no scenes row. A pill’s name, icon and color are in its settings.' }, []));
    }
    a_roomOrder(c, aid) {
      var self = this;
      var inRoom = this.accIds().filter(function (id) { return self.areaOf(id) === aid; });
      var own = (((this.data.accessories || {}).rooms || {})[aid] || []).filter(function (id) { return inRoom.indexOf(id) >= 0; });
      var auto = !own.length;
      var rest = inRoom.filter(function (id) { return own.indexOf(id) < 0; }).sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); });
      var save = function (v) { self.ws({ type: DOMAIN + '/accessory/order', area_id: aid, entities: v }); };
      c.appendChild(K.listEditor({ fk: 'ro', auto: auto, minRows: 1, announce: this.announce.bind(this),
        autoFooter: 'Automatic: the room’s tiles in the screen’s usual order.',
        rows: own.concat(rest).map(function (id) { return { value: id, label: self.name(id) }; }),
        onAuto: function (on) {
          if (!on) { save(own.concat(rest)); return; }
          self.confirmSwitch({ title: 'Use the automatic order?', message: 'This room’s tile order will be cleared.', ok: 'Use Automatic' },
              function () { save([]); });
        },
        onChange: save }));
      c.appendChild(K.group({ footer: 'On Home and the room’s page, on every generated screen.' }, []));
    }
    a_pageOrder(c, page) {
      var self = this, P = PAGE_ORDERS[page];
      var az = function (a, b) { return self.name(a).localeCompare(self.name(b)); };
      var all = page === 'security'
        ? this.entityIds({ domains: ['lock'], shown: true }).sort(az)
            .concat(this.entityIds({ domains: ['cover'], dc: 'garage', shown: true }).sort(az))
        : this.entityIds({ domains: ['vacuum'], shown: true }).sort(az);
      var own = ((((this.data.accessories || {}).pages || {})[page]) || []).filter(function (id) { return all.indexOf(id) >= 0; });
      var save = function (v) { self.ws({ type: DOMAIN + '/accessory/page_order', page: page, entities: v }); };
      c.appendChild(K.listEditor({ fk: 'po', auto: !own.length, minRows: 1, announce: this.announce.bind(this),
        autoFooter: 'Automatic: ' + P[2] + '.',
        rows: own.concat(all.filter(function (id) { return own.indexOf(id) < 0; })).map(function (id) { return { value: id, label: self.name(id) }; }),
        onAuto: function (on) { save(on ? [] : own.concat(all.filter(function (id) { return own.indexOf(id) < 0; }))); },
        onChange: save }));
    }
    // ------------------------------------------------ hidden accessories
    // What hides what (hiding.py snapshot, in panel/get as `hidden`): each
    // accessory's places (`can`), the ones it is hidden from (`off`), and
    // the house's Hidden from Screens lists (everywhere, devices, areas) --
    // stored as they always were (generated.exclude_*).
    hid() {
      return this.data.hidden || { places: {}, order: [], can: {}, off: {}, everywhere: [], devices: [], areas: [] };
    }
    devName(did) { var d = (this.client.devices || {})[did]; return d ? (d.name_by_user || d.name || did) : 'A Removed Device'; }
    devOf(id) { return ((this.client.entities || {})[id] || {}).device_id || null; }
    // what hides it, in a few words: "" when nothing does
    hideText(id) {
      var H = this.hid(), dv = this.devOf(id), a = this.areaOf(id);
      if (dv && H.devices.indexOf(dv) >= 0) return 'With Its Device';
      if (a && H.areas.indexOf(a) >= 0) return 'With Its Room';
      if (H.everywhere.indexOf(id) >= 0) return 'Everywhere';
      var seen = {}, names = [];
      (H.off[id] || []).forEach(function (k) {
        var n = k === 'room' ? 'Room Page' : (H.places[k] || [k])[0];
        if (!seen[n]) { seen[n] = 1; names.push(n); }
      });
      return names.length > 2 ? names.slice(0, 2).join(', ') + ' +' + (names.length - 2) : names.join(', ');
    }
    placeName(k, ids) {
      var H = this.hid();
      if (k !== 'room') return (H.places[k] || [k])[0];
      var a = ids && ids.length === 1 ? this.areaOf(ids[0]) : null;
      return a ? this.areaName(a) + ' Room Page' : 'Room Pages';
    }
    hiddenCount() {
      var H = this.hid(), devs = this.client.devices || {}, areas = this.client.areas || {};
      return this.hiddenEntities().length + H.devices.filter(function (d) { return devs[d]; }).length +
        H.areas.filter(function (a) { return areas[a]; }).length;
    }
    // accessories hidden one by one -- not those hidden with a whole device or room
    hiddenEntities() {
      var H = this.hid(), self = this, seen = {};
      return H.everywhere.concat(Object.keys(H.off)).filter(function (id) {
        if (seen[id] || !self.client.states[id]) return false;
        seen[id] = true;
        var dv = self.devOf(id), a = self.areaOf(id);
        return !(dv && H.devices.indexOf(dv) >= 0) && !(a && H.areas.indexOf(a) >= 0);
      });
    }
    accGlyph(id) {
      var a = ((this.data.accessories || {}).entities || {})[id] || {}, st = this.client.states[id];
      if (a.icon) return String(a.icon).replace(/^mdi:/, 'hk:');
      if (st && st.attributes.icon) return st.attributes.icon;
      return { light: 'mdi:lightbulb', switch: 'mdi:toggle-switch-variant', fan: 'mdi:fan', cover: 'mdi:window-shutter',
               lock: 'mdi:lock', climate: 'mdi:thermostat', media_player: 'mdi:speaker', vacuum: 'mdi:robot-vacuum',
               camera: 'mdi:cctv', valve: 'mdi:valve', humidifier: 'mdi:air-humidifier', water_heater: 'mdi:water-boiler',
               timer: 'mdi:timer-outline', sensor: 'mdi:eye', binary_sensor: 'mdi:radiobox-marked' }[id.split('.')[0]] || 'mdi:circle-small';
    }
    // the answer to hidden/set, for the accessories it was about, over the page's copy
    hideMerge(ids, snap) {
      var H = this.data.hidden;
      if (!H || !snap) return;
      ids.forEach(function (id) {
        H.everywhere = H.everywhere.filter(function (x) { return x !== id; });
        if ((snap.everywhere || []).indexOf(id) >= 0) H.everywhere.push(id);
        if ((snap.off || {})[id]) H.off[id] = snap.off[id]; else delete H.off[id];
        if ((snap.can || {})[id]) H.can[id] = snap.can[id];
      });
    }
    hideSend(ids, everywhere, places) {
      var self = this, H = this.hid();
      // shown at once, as it will be saved; the answer then replaces it
      var guess = { everywhere: everywhere ? ids.slice() : [], off: {}, can: {} };
      if (!everywhere) ids.forEach(function (id) {
        var off = (H.can[id] || []).filter(function (k) { return places[k]; });
        if (off.length) guess.off[id] = off;
      });
      return this.save({ type: DOMAIN + '/hidden/set', entity_ids: ids, everywhere: everywhere, places: everywhere ? {} : places },
        ['hide'], function () { self.hideMerge(ids, guess); }, function (r) { self.hideMerge(ids, r); });
    }
    a_hidden(c) {
      var self = this, H = this.hid(), client = this.client, devs = client.devices || {};
      var v = this._hv || (this._hv = { f: 'all', q: '' });
      c.appendChild(K.group({}, [K.button({ label: 'Hide Accessories…', fk: 'hide:start', onClick: function () {
        self._hp = { ents: [], devs: [], tab: 'acc', q: '' };
        self._hd = null;
        self.go('#/accessories/hidden/pick');
      } })]));
      c.appendChild(K.group({}, [K.seg({ label: 'Show', fk: 'hide:filter', value: v.f,
        options: [['all', 'All'], ['every', 'Everywhere'], ['some', 'Some Places']],
        onChange: function (x) { v.f = x; self.render(); } })]));
      var sb = h('div', { class: 'search', style: 'margin:0 0 22px' });
      sb.appendChild(K.icon('mdi:magnify', 'mag'));
      var inp = h('input', { type: 'search', placeholder: 'Search Hidden', 'aria-label': 'Search hidden accessories', 'data-fk': 'hide:search' });
      inp.value = v.q;
      sb.appendChild(inp);
      c.appendChild(sb);
      var box = h('div');
      c.appendChild(box);
      var paint = function () {
        box.innerHTML = '';
        var q = inp.value.trim().toLowerCase();
        var m = function (s) { return !q || s.toLowerCase().indexOf(q) >= 0; };
        var recent = (self._hr || []).filter(function (id) { return !q; });
        var row = function (id) {
          var why = self.hideText(id);
          return K.nav({ label: self.name(id), sub: (self.areaName(self.areaOf(id)) || 'No room') + ' · ' + id, icon: self.accGlyph(id),
                         value: why || 'Shown Everywhere', href: '#/accessories/hidden/edit/' + encodeURIComponent(id), fk: 'hide:' + id });
        };
        if (recent.length) box.appendChild(K.group({ header: 'Just Now', footer: 'What you just changed. It joins the lists below when you leave this page.' },
          recent.map(function (r) {
            if (r.indexOf('dev:') === 0) {
              var did = r.slice(4), hid = H.devices.indexOf(did) >= 0;
              return K.nav({ label: self.devName(did), icon: 'mdi:devices', value: hid ? 'Everywhere' : 'Shown Everywhere',
                             href: '#/accessories/hidden/device/' + encodeURIComponent(did) });
            }
            return row(r);
          })));
        var isRecent = function (x) { return recent.indexOf(x) >= 0; };
        if (v.f !== 'some') {
          var rooms = H.areas.filter(function (a) { return (client.areas || {})[a] && m(self.areaName(a)); });
          if (rooms.length) box.appendChild(K.group({ header: 'Whole Rooms', footer: 'A room is hidden from its own Room Settings, with everything in it.' },
            rooms.map(function (a) {
              return K.nav({ label: self.areaName(a), icon: ((client.areas || {})[a] || {}).icon || 'mdi:texture-box', value: 'Everywhere',
                             href: '#/house/rooms/' + encodeURIComponent(a) });
            })));
          var dl = H.devices.filter(function (d) { return devs[d] && !isRecent('dev:' + d) && m(self.devName(d) + ' ' + self.areaName(devs[d].area_id)); })
            .sort(function (a, b) { return self.devName(a).localeCompare(self.devName(b)); });
          if (dl.length) box.appendChild(K.group({ header: 'Whole Devices', footer: 'Every accessory of a hidden device is hidden everywhere.' },
            dl.map(function (d) {
              var n = Object.keys(client.entities || {}).filter(function (id) { return client.entities[id].device_id === d && client.states[id]; }).length;
              return K.nav({ label: self.devName(d), sub: (self.areaName(devs[d].area_id) || 'No room') + ' · ' + n + (n === 1 ? ' entity' : ' entities'),
                             icon: 'mdi:devices', value: 'Everywhere', href: '#/accessories/hidden/device/' + encodeURIComponent(d), fk: 'hide:dev:' + d });
            })));
        }
        var ents = self.hiddenEntities().filter(function (id) {
          if (isRecent(id)) return false;
          var every = H.everywhere.indexOf(id) >= 0;
          return (v.f === 'all' || (v.f === 'every') === every) && m(self.name(id) + ' ' + id + ' ' + self.areaName(self.areaOf(id)) + ' ' + self.hideText(id));
        }).sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); });
        if (ents.length) box.appendChild(K.group({ header: 'Accessories', footer: 'On the right: where each one is hidden. Tap one to change it.' }, ents.map(row)));
        // BY PAGE: what each page and chip has hidden from it, with Show All Again
        var byK = {};
        Object.keys(H.off).forEach(function (id) { (H.off[id] || []).forEach(function (k) { if (k !== 'home' && k !== 'room') byK[k] = (byK[k] || 0) + 1; }); });
        var kl = (H.order || []).filter(function (k) { return byK[k] && m(self.placeName(k)); });
        if (kl.length && v.f !== 'every') box.appendChild(K.group({ header: 'By Page', footer: 'What each page and chip has hidden from it.' },
          kl.map(function (k) {
            return K.nav({ label: self.placeName(k), sub: (H.places[k] || ['', ''])[1], value: byK[k] + ' Hidden',
                           href: '#/accessories/hidden/kind/' + k, fk: 'hide:kind:' + k });
          })));
        var goneD = H.devices.filter(function (d) { return !devs[d]; }), goneE = H.everywhere.filter(function (id) { return !client.states[id]; });
        if ((goneD.length || goneE.length) && v.f !== 'some' && !q) {
          box.appendChild(K.group({ header: 'No Longer in Home Assistant', footer: 'Hidden once, then removed from Home Assistant. Nothing shows them now.' },
            goneD.map(function (d) { return K.info({ label: 'A removed device', sub: d, value: 'Gone' }); })
              .concat(goneE.map(function (id) { return K.info({ label: id, value: 'Gone' }); }))
              .concat([K.button({ label: 'Clear These', destructive: true, fk: 'hide:clear', onClick: function () {
                var g = self.data.settings.generated, ch = {};
                if (goneD.length) ch['generated.exclude_devices'] = (g.exclude_devices || []).filter(function (d) { return goneD.indexOf(d) < 0; });
                if (goneE.length) ch['generated.exclude_entities'] = (g.exclude_entities || []).filter(function (id) { return goneE.indexOf(id) < 0; });
                self.setH(ch);
              } })])));
        }
        if (!box.children.length) box.appendChild(K.group({ footer: q ? 'Nothing hidden matches.' : 'Nothing is hidden.' }, []));
      };
      inp.addEventListener('input', function () { v.q = inp.value; paint(); });
      paint();
    }
    // HIDE ACCESSORIES, step one: tick one or several (or whole devices), then
    // Next -- the picker every other page uses now (pickList); a device is
    // ticked as "dev:<id>"
    a_hidePick(c) {
      var self = this, H = this.hid(), client = this.client, devs = client.devices || {};
      var p = this._hp || (this._hp = { ents: [], devs: [], tab: 'acc', q: '' });
      if (!p.sel) p.sel = p.ents.concat(p.devs.map(function (d) { return 'dev:' + d; }));
      this.pickList(c, { title: 'Accessories', multi: true, sel: p.sel, verb: 'Next',
        tabs: [['acc', 'Accessories'], ['dev', 'Whole Devices']], tab: p.tab,
        onTab: function (x) { p.tab = x; self.render(); },
        query: p.q, onQuery: function (q) { p.q = q; },
        items: function (tab) {
          if (tab === 'dev') {
            return Object.keys(devs).filter(function (d) {
              return Object.keys(client.entities || {}).some(function (id) {
                return client.entities[id].device_id === d && client.states[id] && !client.entities[id].entity_category; });
            }).map(function (d) {
              return { value: 'dev:' + d, label: self.devName(d), room: self.areaName(devs[d].area_id) || '', icon: 'mdi:devices',
                       note: H.devices.indexOf(d) >= 0 ? 'Hidden · Everywhere' : '' };
            });
          }
          var ids = {};
          self.accIds().concat(Object.keys(H.can), H.everywhere).forEach(function (id) { if (client.states[id]) ids[id] = 1; });
          return Object.keys(ids).map(function (id) {
            var why = self.hideText(id);
            return { value: id, label: self.name(id), note: why ? 'Hidden · ' + why : '' };
          });
        },
        onDone: function (v) {
          p.ents = v.filter(function (x) { return x.indexOf('dev:') !== 0; });
          p.devs = v.filter(function (x) { return x.indexOf('dev:') === 0; }).map(function (x) { return x.slice(4); });
          self._hd = null;
          self.go('#/accessories/hidden/where');
        } });
    }
    // HIDE FROM: Everywhere, or only from the places chosen. For what was just
    // picked (id null) it waits for Hide; for one accessory (id) each switch
    // saves as it changes, as the rest of HK Settings does.
    a_hideWhere(c, id) {
      var self = this, H = this.hid(), client = this.client;
      var p = this._hp || { ents: [], devs: [] };
      var ents = id ? [id] : p.ents.filter(function (x) { return client.states[x]; }), dvs = id ? [] : p.devs.slice();
      if (!ents.length && !dvs.length) { c.appendChild(K.group({ footer: 'Nothing picked.' }, [K.nav({ label: 'Pick Accessories', href: '#/accessories/hidden/pick' })])); return; }
      // the choice: one accessory's is what is saved; a new hide's starts at Everywhere
      var d;
      if (id) d = { every: H.everywhere.indexOf(id) >= 0, places: {} };
      else d = this._hd || (this._hd = { every: true, places: {} });
      if (id && !d.every) (H.off[id] || []).forEach(function (k) { d.places[k] = true; });
      var one = ents.length === 1 && !dvs.length ? ents[0] : null;
      var head = one ? K.info({ label: this.name(one), sub: (this.areaName(this.areaOf(one)) || 'No room') + ' · ' + one, icon: this.accGlyph(one) })
        : K.info({ label: [ents.length ? ents.length + (ents.length === 1 ? ' Accessory' : ' Accessories') : '',
                           dvs.length ? dvs.length + (dvs.length === 1 ? ' Device' : ' Devices') : ''].filter(Boolean).join(' and '),
                   sub: ents.map(function (x) { return self.name(x); }).concat(dvs.map(function (x) { return self.devName(x); })).join(', ') });
      c.appendChild(K.group({}, [head].concat(id ? [K.nav({ label: 'Accessory Settings', href: '#/accessories/' + encodeURIComponent(id) })] : [])));
      var dv = id && this.devOf(id), ar = id && this.areaOf(id);
      if (id && ((dv && H.devices.indexOf(dv) >= 0) || (ar && H.areas.indexOf(ar) >= 0))) {
        var byDev = dv && H.devices.indexOf(dv) >= 0;
        c.appendChild(K.group({ footer: byDev ? 'Its whole device is hidden everywhere.' : 'Its whole room is hidden everywhere.' }, [
          K.nav({ label: byDev ? self.devName(dv) : self.areaName(ar), value: 'Everywhere',
                  href: byDev ? '#/accessories/hidden/device/' + encodeURIComponent(dv) : '#/house/rooms/' + encodeURIComponent(ar) })]));
        return;
      }
      var commit = function () { if (id) self.hideSend([id], d.every, d.places); else self.render(); };
      if (!ents.length) {
        c.appendChild(K.group({ footer: 'A whole device is hidden everywhere. To hide it from just some places, pick its accessories instead.' },
          [K.toggle({ label: 'Everywhere', on: true, disabled: true, onChange: function () {} })]));
      } else {
        c.appendChild(K.group({ footer: 'It stays in Home Assistant, and in its automations.' + (dvs.length ? ' The devices picked are hidden everywhere either way.' : '') }, [
          K.toggle({ label: 'Everywhere', sub: 'Every screen, page and chip', on: d.every, fk: 'hide:every',
                     onChange: function (on) { d.every = on; commit(); } })]));
        var counts = {}, order = H.order || [];
        ents.forEach(function (x) { (H.can[x] || []).forEach(function (k) { counts[k] = (counts[k] || 0) + 1; }); });
        var keys = order.filter(function (k) { return counts[k]; });
        var rows = keys.map(function (k) {
          var sub = (H.places[k] || ['', ''])[1];
          if (k === 'room' && one) sub = 'Its tile on the ' + self.areaName(self.areaOf(one)) + ' page';
          if (ents.length > 1 && counts[k] < ents.length) sub += ' · applies to ' + counts[k] + ' of ' + ents.length;
          return K.toggle({ label: self.placeName(k, ents), sub: sub, on: d.every || !!d.places[k], disabled: d.every, fk: 'hide:pl:' + k,
                            onChange: function (on) { d.places[k] = on; commit(); } });
        });
        c.appendChild(K.group({ header: 'Or Only From', footer: !rows.length ? 'There’s nowhere else to hide it from.' :
            d.every ? 'Turn off Everywhere to choose.' : 'Hidden from what’s on. Everywhere else it shows as usual.' }, rows));
      }
      if (this.err('hide')) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('hide') }));
      if (id) {
        c.appendChild(K.group({}, [K.button({ label: 'Show Everywhere Again', destructive: true, fk: 'hide:show', onClick: function () {
          self._hr = [id];
          self.hideSend([id], false, {}).then(function (ok) { if (ok) self.back('#/accessories/hidden'); });
        } })]));
        return;
      }
      var n = ents.length + dvs.length;
      var none = !d.every && ents.length && !Object.keys(d.places).some(function (k) { return d.places[k]; });
      c.appendChild(K.group({}, [K.button({ label: n === 1 ? 'Hide' : 'Hide ' + n, fk: 'hide:go', disabled: !!none, onClick: function () {
        var jobs = [];
        if (ents.length) jobs.push(self.hideSend(ents, d.every, d.places));
        if (dvs.length) {
          var cur = self.data.settings.generated.exclude_devices || [];
          jobs.push(self.setH({ 'generated.exclude_devices': cur.concat(dvs.filter(function (x) { return cur.indexOf(x) < 0; })) }));
        }
        Promise.all(jobs).then(function (oks) {
          if (oks.some(function (ok) { return !ok; })) return;
          self._hr = ents.concat(dvs.map(function (x) { return 'dev:' + x; }));
          self._hp = null; self._hd = null;
          self.back('#/accessories/hidden');
        });
      } })]));
    }
    // ONE PAGE'S HIDDEN (By Page): what is hidden from it, and Show All Again
    // (was Status & Chips' Reset to Automatic: what was added stays added)
    a_hideKind(c, kind) {
      var self = this, H = this.hid(), ck = (this.data.counts || {})[kind] || { exclude: [], include: [] };
      var ids = Object.keys(H.off).filter(function (id) { return (H.off[id] || []).indexOf(kind) >= 0; })
        .sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); });
      c.appendChild(K.group({ footer: (H.places[kind] || ['', ''])[1] + '.' }, ids.map(function (id) {
        return K.nav({ label: self.name(id), sub: (self.areaName(self.areaOf(id)) || 'No room') + ' · ' + id, icon: self.accGlyph(id),
                       value: self.hideText(id), href: '#/accessories/hidden/edit/' + encodeURIComponent(id) });
      })));
      if (!ids.length) return;
      c.appendChild(K.group({ footer: 'Everything ' + this.placeName(kind) + ' finds is shown there again. What was added with Also Count As stays.' }, [
        K.button({ label: 'Show All Again…', destructive: true, fk: 'hide:kindall', onClick: function () {
          K.confirm(self.shadowRoot, { title: 'Show All on ' + self.placeName(kind) + ' Again?', message: ids.length + ' hidden from it will show again.',
                                        ok: 'Show All', destructive: true }).then(function (yes) {
            if (!yes) return;
            var o = {}; o['counts.' + kind] = { exclude: [], include: ck.include || [] };
            self._hr = ids.slice();
            self.setH(o).then(function (ok) { if (ok) self.back('#/accessories/hidden'); });
          });
        } })]));
    }
    a_hideDevice(c, did) {
      var self = this, client = this.client, g = this.data.settings.generated, cur = g.exclude_devices || [], hid = cur.indexOf(did) >= 0;
      var dev = (client.devices || {})[did];
      var ids = Object.keys(client.entities || {}).filter(function (id) { return client.entities[id].device_id === did && client.states[id] && !client.entities[id].entity_category; });
      c.appendChild(K.group({ footer: hid ? 'Every accessory of this device is hidden everywhere. It stays in Home Assistant.' : 'Shown wherever HK puts its accessories.' }, [
        K.info({ label: this.devName(did), sub: dev ? (this.areaName(dev.area_id) || 'No room') : did, icon: 'mdi:devices' }),
        K.toggle({ label: 'Hidden Everywhere', on: hid, fk: 'hide:dev', onChange: function (on) {
          self._hr = ['dev:' + did];
          self.setH({ 'generated.exclude_devices': on ? cur.concat(did) : cur.filter(function (x) { return x !== did; }) });
        } })]));
      if (ids.length) c.appendChild(K.group({ header: 'Its Accessories' }, ids.sort().map(function (id) {
        return K.nav({ label: self.name(id), sub: id, icon: self.accGlyph(id), href: '#/accessories/' + encodeURIComponent(id) });
      })));
    }
    // ADDED ACCESSORIES (generated.include_entities; was Also Shown): a tile
    // for something HK doesn't make one for by itself. Offered: what isn't
    // an accessory already, under its room as every picker has it.
    a_also(c) {
      var self = this, cur = this.data.settings.generated.include_entities || [];
      var set = function (v) { self.setH({ 'generated.include_entities': v }); };
      var tiles = {};
      this.accIds().forEach(function (id) { tiles[id] = 1; });
      c.appendChild(K.listEditor({ fk: 'also', reorder: false, shownHeader: 'Added', emptyText: 'Nothing added', announce: this.announce.bind(this),
        rows: cur.map(function (id) { return { value: id, label: self.name(id), sub: (self.areaName(self.areaOf(id)) || 'No room') + ' · ' + id, icon: self.accGlyph(id) }; }),
        onChange: set, addLabel: 'Add…', onAddOther: function () {
          self.go(self.picker('also-add', { title: 'Add Accessories', value: null, multi: true,
            items: function () {
              var ents = self.client.entities || {};
              return Object.keys(self.client.states).filter(function (id) {
                var e = ents[id] || {};
                return cur.indexOf(id) < 0 && !tiles[id] && !e.hidden && !e.entity_category;
              }).map(function (id) { return { value: id, label: self.name(id) }; });
            },
            onPick: function (v) { var add = [].concat(v || []); if (add.length) set(cur.concat(add)); } }));
        } }));
      c.appendChild(K.group({ footer: 'Each one gets a tile in its room on Home and its room’s page, or in a section called More when it has no room. Remove one to take its tile away; it stays in Home Assistant.' }, []));
    }
    a_one(c, id) {
      var self = this;
      if (!this.client.states[id]) { c.appendChild(K.group({ footer: 'This entity doesn’t exist any more.' }, [])); return; }
      var box = h('div', { class: 'accwrap' });
      c.appendChild(box);
      loadCards().then(function () {
        var D = window.hkDetail && window.hkDetail._;
        if (!D || !D.accessoryPane) { box.appendChild(K.group({ footer: 'The accessory settings couldn’t load.' }, [])); return; }
        var st = document.createElement('style');
        st.textContent = D.ACC_CSS || '';
        box.appendChild(st);
        box.appendChild(D.accessoryPane(self.client, id, function () { self.status('saved'); self.soon(); }, { panel: true, onSaved: function (ok) { self.status(ok ? 'saved' : 'error'); } }));
      });
    }

    // ---------------------------------------------------------- pop-ups
    p_popups(sub) {
      var self = this, back = ['Pop-ups', '#/popups'];
      if (sub[0] === 'new') return { title: 'New Pop-up', back: back, body: function (c) { self.pop_new(c); } };
      if (sub[0]) {
        var p = this.data.popups.filter(function (x) { return x.hash === sub[0]; })[0];
        if (!p) return { title: 'Pop-up', back: back, body: function (c) { c.appendChild(K.group({ footer: 'There’s no pop-up #' + sub[0] + '.' }, [])); } };
        if (sub[1] === 'accessories') return { title: 'Accessories', back: [p.name || p.hash, '#/popups/' + p.hash], body: function (c) { self.pop_entities(c, p); } };
        if (sub[1] === 'cards' && p.kind === 'cards') return { title: 'Cards', back: [p.name || p.hash, '#/popups/' + p.hash], body: function (c) {
          self.yamlPage(c, { value: p.cards, sk: 'pop:cards', clear: false,
            help: 'The sheet’s cards, as a list in YAML — any card, one under another. The sheet has its own name and glyph above them.',
            example: '- type: custom:hk-heading-card\n  name: Garage\n- type: tile\n  entity: cover.garage_door\n- type: custom:hk-camera-card\n  entity: camera.garage',
            onSave: function (v) {
              var cards = Array.isArray(v) ? v : v && v.type ? [v] : [];
              self.popupSave(p, { cards: cards }).then(function () { if (!self.err('pop:' + p.hash)) self.back('#/popups/' + p.hash); });
            } });
        } };
        return { title: p.name || '#' + p.hash, back: back, scope: 'Opens on a screen whose address ends in <b>#' + K.esc(p.hash) + '</b>.',
                 body: function (c) { self.pop_one(c, p); } };
      }
      return { title: 'Pop-ups', top: true, scope: 'Sheets an automation can open on any screen — the doorbell, the alarm keypad.', body: function (c) {
        var d = self.data;
        c.appendChild(K.group({ footer: 'An automation opens one with the hk_frontend.show_popup action, or by loading a screen’s address ending in its #.' },
          d.popups.map(function (p) {
            return K.nav({ label: p.name || p.hash, value: '#' + p.hash, href: '#/popups/' + p.hash,
                           icon: p.kind === 'camera' ? 'mdi:doorbell-video' : p.kind === 'alarm' ? 'mdi:shield-home' :
                                 p.kind === 'cards' ? p.icon || 'mdi:card-text-outline' : 'mdi:view-grid' });
          }).concat([K.nav({ label: 'Add Pop-up', href: '#/popups/new', cls: 'tintc', icon: 'mdi:plus' })])));
      } };
    }
    async popupFlow(p, values) {
      var base = 'config/config_entries/subentries/flow';
      var r = await this.rest('POST', base, { handler: [this.data.entry_id, 'popup'], subentry_id: p.item });
      var body = {};
      Object.keys(values).forEach(function (k) {
        var v = values[k];
        if (v === '' || v === null || v === undefined) return;
        body[k] = v;
      });
      var r2;
      try { r2 = await this.rest('POST', base + '/' + r.flow_id, body); } catch (e) {
        this.rest('DELETE', base + '/' + r.flow_id).catch(function () {});
        throw e;
      }
      if (r2.type === 'form') {
        this.rest('DELETE', base + '/' + r.flow_id).catch(function () {});
        var code = r2.errors && Object.keys(r2.errors).map(function (k) { return r2.errors[k]; })[0];
        throw new Error(M.errorText(code || 'unknown'));
      }
    }
    popupSave(p, changes) {
      var self = this;
      var v = { name: p.name, close_after: p.close_after, dashboards: p.dashboards };
      if (p.kind === 'camera') { v.entity = p.entity; v.speaker = p.speaker; v.stream = p.stream; }
      else if (p.kind === 'alarm') v.entity = p.entity;
      else if (p.kind === 'cards') { v.cards = p.cards; v.icon = p.icon; v.width = p.width; }
      else v.entities = p.entities;
      Object.assign(v, changes);
      Object.assign(p, changes);
      this.render();
      this.status('saving');
      return this.popupFlow(p, v).then(function () {
        self.status('saved'); return self.reload().then(function () { self.render(); });
      }, function (e) {
        self.status('error'); self.errors['pop:' + p.hash] = String(e && e.message || e);
        return self.reload().then(function () { self.render(); });
      });
    }
    pop_one(c, p) {
      var self = this, save = function (ch) { delete self.errors['pop:' + p.hash]; return self.popupSave(p, ch); };
      var kind = M.POPUP_KINDS.filter(function (k) { return k[0] === p.kind; })[0] || [p.kind, p.kind];
      c.appendChild(K.group({}, [
        K.text({ label: 'Name', sk: 'pop:name', value: p.name, maxlength: 60, onCommit: function (v) { if (v.trim()) save({ name: v.trim() }); } }),
        K.info({ label: 'Type', value: kind[1] }), K.info({ label: 'Address', value: '#' + p.hash })]));
      if (this.err('pop:' + p.hash)) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('pop:' + p.hash) }));
      if (p.kind === 'camera') {
        c.appendChild(K.group({ header: 'Camera', footer: 'Live talk-back needs UniFi Protect and the camera’s own speaker; without them it plays a recorded clip. A higher-resolution stream can be shown live.' }, [
          this.entityRow({ label: 'Camera', sk: 'pop:entity', value: p.entity, none: null, filter: { domains: ['camera'] },
                           onPick: function (v) { if (v) save({ entity: v }); } }),
          this.entityRow({ label: 'Talk-Back Speaker', sk: 'pop:speaker', value: p.speaker, none: 'The Camera’s Own', filter: { domains: ['media_player'] },
                           onPick: function (v) { save({ speaker: v || '' }); } }),
          this.entityRow({ label: 'Live Stream', sk: 'pop:stream', value: p.stream, none: 'Its High-Resolution Channel', filter: { domains: ['camera'] },
                           onPick: function (v) { save({ stream: v || '' }); } })]));
      } else if (p.kind === 'alarm') {
        c.appendChild(K.group({ header: 'Alarm' }, [
          this.entityRow({ label: 'Alarm Panel', sk: 'pop:entity', value: p.entity, none: this.sameAsGeneral(), filter: { domains: ['alarm_control_panel'] },
                           onPick: function (v) { save({ entity: v || '' }); } })]));
      } else if (p.kind === 'cards') {
        c.appendChild(K.group({ header: 'Sheet', footer: 'Any cards — Home Assistant’s own, or a custom card’s.' }, [
          K.nav({ label: 'Cards', value: p.cards.length ? String(p.cards.length) : 'None Yet', href: '#/popups/' + p.hash + '/cards', sk: 'pop:cards' }),
          K.text({ label: 'Icon', sk: 'pop:icon', value: p.icon, placeholder: 'mdi:card-text-outline', maxlength: 60, autocomplete: 'off',
                   error: this.err('pop:icon'),
                   onCommit: function (v) {
                     v = v.trim();
                     if (v && !/^(mdi|hk):[a-z0-9-]+$/.test(v)) { self.errors['pop:icon'] = M.errorText('icon'); self.render(); return; }
                     delete self.errors['pop:icon']; save({ icon: v });
                   } }),
          K.select({ label: 'Width', sk: 'pop:width', value: p.width, options: [['narrow', 'Narrow'], ['wide', 'Wide']],
                     onChange: function (v) { save({ width: v }); } })]));
      } else {
        c.appendChild(K.group({ header: 'Accessories' }, [K.nav({ label: 'Accessories', value: String(p.entities.length),
                                                                  href: '#/popups/' + p.hash + '/accessories' })]));
      }
      var opts = M.CLOSE_AFTER.slice();
      if (!opts.some(function (o) { return o[0] === p.close_after; })) opts.push([p.close_after, p.close_after + ' Seconds']);
      c.appendChild(K.group({}, [K.select({ label: 'Close After', sk: 'pop:close', value: p.close_after,
        options: opts.map(function (o) { return [String(o[0]), o[1]]; }), onChange: function (v) { save({ close_after: Number(v) }); } })]));
      var screens = this.data.dashboards.filter(function (x) { return x.item; });
      var all = !p.dashboards.length;
      var srows = [K.toggle({ label: 'Show on Every Screen', sk: 'pop:all', on: all, onChange: function (on) {
        save({ dashboards: on ? [] : screens.filter(function (x) { return (self.data.boards[x.path] || {}).popups !== false; }).map(function (x) { return x.path; }) });
      } })];
      if (!all) {
        screens.forEach(function (x) {
          var on = p.dashboards.indexOf(x.path) >= 0;
          var answers = (self.data.boards[x.path] || {}).popups !== false;
          srows.push(K.check({ label: x.title, sub: answers ? null : 'Allow Pop-ups is off on this screen', multi: true, on: on, fk: 'pop:d:' + x.path,
            onClick: function () {
              var next = p.dashboards.filter(function (d) { return d !== x.path; });
              if (!on) next.push(x.path);
              if (!next.length) { self.announce('Turn on All Screens instead.'); return; }
              save({ dashboards: next });
            } }));
        });
      }
      c.appendChild(K.group({ header: 'Screens', footer: 'A screen with Allow Pop-ups turned off never shows one.' }, srows));
      c.appendChild(K.group({}, [K.button({ label: 'Delete Pop-up…', destructive: true, sk: 'pop:delete', onClick: function () {
        K.confirm(self.shadowRoot, { title: 'Delete #' + p.hash + '?', message: 'Automations that open it will open nothing.', ok: 'Delete', destructive: true })
          .then(function (yes) {
            if (!yes) return;
            self.ws({ type: 'config_entries/subentries/delete', entry_id: self.data.entry_id, subentry_id: p.item }).then(function (ok) {
              if (ok) self.reload().then(function () { self.go('#/popups'); });
            });
          });
      } })]));
    }
    pop_entities(c, p) {
      var self = this;
      c.appendChild(K.listEditor({ fk: 'pe', shownHeader: 'On the Sheet', minRows: 1, announce: this.announce.bind(this),
        rows: p.entities.map(function (id) { return { value: id, label: self.name(id) }; }),
        onChange: function (v) { self.popupSave(p, { entities: v }); },
        addLabel: 'Add Accessory…', onAddOther: function () {
          self.go(self.picker('pe-add', { title: 'Add Accessory', value: null, multi: true,
            items: function () { return self.entityIds({ re: TILE_DOMAINS, shown: true }).filter(function (id) { return p.entities.indexOf(id) < 0; })
              .map(function (id) { return { value: id, label: self.name(id), sub: self.areaName(self.areaOf(id)) || id }; }); },
            onPick: function (id) { if (id) self.popupSave(p, { entities: p.entities.concat(id) }); } }));
        } }));
    }
    pop_new(c) {
      var self = this, np = this._np = this._np || { name: '', hash: '', kind: 'camera', entity: null, speaker: null, stream: null, entities: [] };
      c.appendChild(K.group({ footer: 'The address is what an automation opens: a screen’s address ending in #' + (np.hash || slug(np.name) || 'front-door') + '.' }, [
        K.text({ label: 'Name', sk: 'np:name', value: np.name, placeholder: 'Front Door', maxlength: 60, onCommit: function (v) { np.name = v; self.render(); } }),
        K.text({ label: 'Address', sk: 'np:hash', value: np.hash, placeholder: slug(np.name) || 'front-door', maxlength: 40,
                 onCommit: function (v) { np.hash = v.replace(/^#/, ''); self.render(); } })]));
      c.appendChild(K.group({ header: 'Type' }, M.POPUP_KINDS.map(function (k) {
        return K.check({ label: k[1], sub: k[2], on: np.kind === k[0], fk: 'np:kind:' + k[0], onClick: function () { np.kind = k[0]; self.render(); } });
      })));
      var pick = function (key) { return function (v) { np[key] = v; self.render(); }; };
      if (np.kind === 'camera') {
        c.appendChild(K.group({ header: 'Camera' }, [
          this.entityRow({ label: 'Camera', sk: 'np:entity', value: np.entity, none: 'Choose…', filter: { domains: ['camera'] }, onPick: pick('entity') }),
          this.entityRow({ label: 'Talk-Back Speaker', sk: 'np:speaker', value: np.speaker, none: 'The Camera’s Own', filter: { domains: ['media_player'] }, onPick: pick('speaker') })]));
      } else if (np.kind === 'alarm') {
        c.appendChild(K.group({ header: 'Alarm' }, [
          this.entityRow({ label: 'Alarm Panel', sk: 'np:entity', value: np.entity, none: this.sameAsGeneral(), filter: { domains: ['alarm_control_panel'] }, onPick: pick('entity') })]));
      } else if (np.kind === 'cards') {
        c.appendChild(K.group({ footer: 'Its cards are written next, in YAML.' }, []));
      } else {
        c.appendChild(K.listEditor({ fk: 'npe', shownHeader: 'Accessories', emptyText: 'None yet', reorder: true,
          rows: np.entities.map(function (id) { return { value: id, label: self.name(id) }; }),
          onChange: function (v) { np.entities = v; self.render(); },
          addLabel: 'Add Accessory…', onAddOther: function () {
            self.go(self.picker('npe-add', { title: 'Add Accessory', value: null, multi: true,
              items: function () { return self.entityIds({ re: TILE_DOMAINS, shown: true }).filter(function (id) { return np.entities.indexOf(id) < 0; })
                .map(function (id) { return { value: id, label: self.name(id), sub: self.areaName(self.areaOf(id)) || id }; }); },
              onPick: function (id) { if (id) { np.entities = np.entities.concat(id); } } }));
          } }));
      }
      if (this.err('np')) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('np') }));
      var ready = np.name.trim() && (np.kind !== 'camera' || np.entity) && (np.kind !== 'accessories' || np.entities.length);
      c.appendChild(K.group({}, [K.button({ label: 'Add Pop-up', center: true, disabled: !ready, fk: 'np:go', onClick: function () {
        self.status('saving');
        self.addPopup(np).then(function (hash) {
          var kind = np.kind;
          self._np = null; delete self.errors.np; self.status('saved');
          return self.reload().then(function () {
            self.go('#/popups/' + hash);
            // then its cards, one step on (so Back is the pop-up's page)
            if (kind === 'cards') setTimeout(function () { self.go('#/popups/' + hash + '/cards'); }, 80);
          });
        }, function (e) { self.errors.np = String(e && e.message || e); self.status('error'); self.render(); });
      } })]));
    }
    async addPopup(np) {
      var base = 'config/config_entries/subentries/flow';
      var r = await this.rest('POST', base, { handler: [this.data.entry_id, 'popup'] });
      var fid = r.flow_id;
      try {
        var first = { name: np.name.trim(), kind: np.kind };
        if (np.hash.trim()) first.hash = np.hash.trim();
        r = await this.rest('POST', base + '/' + fid, first);
        if (r.type === 'form' && r.step_id === 'user') throw new Error(M.errorText(Object.keys(r.errors || {}).map(function (k) { return r.errors[k]; })[0]));
        var det = { close_after: np.kind === 'alarm' ? 3600 : 60 };
        if (np.entity) det.entity = np.entity;
        if (np.kind === 'camera' && np.speaker) det.speaker = np.speaker;
        if (np.kind === 'accessories') det.entities = np.entities;
        if (np.kind === 'cards') det.width = 'narrow';
        r = await this.rest('POST', base + '/' + fid, det);
        if (r.type !== 'create_entry') throw new Error(M.errorText(Object.keys(r.errors || {}).map(function (k) { return r.errors[k]; })[0]));
        return r.result && r.result.unique_id || first.hash || slug(np.name);
      } catch (e) {
        this.rest('DELETE', base + '/' + fid).catch(function () {});
        throw e;
      }
    }

    // ---------------------------------------------------------- custom pages
    p_pages(sub) {
      var self = this, back = ['Custom Pages', '#/pages'];
      if (sub[0] === 'new') return { title: 'New Page', back: back, body: function (c) { self.pg_new(c); } };
      if (sub[0]) {
        var p = (this.data.custom_pages || []).filter(function (x) { return x.path === sub[0]; })[0];
        if (!p) return { title: 'Page', back: back, body: function (c) { c.appendChild(K.group({ footer: 'There’s no page /' + sub[0] + '.' }, [])); } };
        if (sub[1] === 'content') return { title: 'Page Content', back: [p.title, '#/pages/' + p.path], body: function (c) {
          self.yamlPage(c, { value: p.view, sk: 'pg:view:' + p.path,
            help: 'The page’s cards, in YAML, as a dashboard view without its title, address and icon.',
            onSave: function (v) { return self.pageSave(p, { view: v }); } });
        } };
        return { title: p.title, back: back, scope: 'At <b>/' + K.esc(p.path) + '</b> on the screens that show it.', body: function (c) { self.pg_one(c, p); } };
      }
      return { title: 'Custom Pages', top: true, scope: 'Pages you write yourself, in YAML. Any generated screen can show them.', body: function (c) {
        c.appendChild(K.group({}, (self.data.custom_pages || []).map(function (p) {
          return K.nav({ label: p.title, icon: p.icon || 'mdi:file-document-outline', href: '#/pages/' + p.path,
                         value: p.used_on.length ? 'On ' + p.used_on.length + ' Screen' + (p.used_on.length > 1 ? 's' : '') : 'Not Shown' });
        }).concat([K.nav({ label: 'Add Page', href: '#/pages/new', cls: 'tintc', icon: 'mdi:plus' })])));
      } };
    }
    async pageSave(p, changes) {
      var base = 'config/config_entries/subentries/flow', self = this;
      var v = Object.assign({ title: p.title, icon: p.icon, view: p.view }, changes);
      var body = { title: v.title, view: v.view };
      if (v.icon) body.icon = v.icon;
      this.status('saving');
      try {
        var r = await this.rest('POST', base, { handler: [this.data.entry_id, 'page'], subentry_id: p.item });
        var r2 = await this.rest('POST', base + '/' + r.flow_id, body);
        if (r2.type === 'form') {
          this.rest('DELETE', base + '/' + r.flow_id).catch(function () {});
          throw new Error(M.errorText(Object.keys(r2.errors || {}).map(function (k) { return r2.errors[k]; })[0]));
        }
        delete this.errors['pg:' + p.path];
        this.status('saved');
      } catch (e) {
        this.errors['pg:' + p.path] = String(e && e.message || e);
        this.status('error');
      }
      await this.reload();
      self.render();
    }
    pg_one(c, p) {
      var self = this;
      c.appendChild(K.group({}, [
        K.text({ label: 'Name', sk: 'pg:title', value: p.title, maxlength: 40, onCommit: function (v) { if (v.trim()) self.pageSave(p, { title: v.trim() }); } }),
        K.text({ label: 'Icon', sk: 'pg:icon', value: p.icon, placeholder: 'mdi:file-document', maxlength: 60,
                 onCommit: function (v) { self.pageSave(p, { icon: v.trim() }); } }),
        K.info({ label: 'Address', value: '/' + p.path })]));
      if (this.err('pg:' + p.path)) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('pg:' + p.path) }));
      var shown = this.data.dashboards.filter(function (x) { return p.used_on.indexOf(x.path) >= 0; });
      c.appendChild(K.group({ header: 'Shown On', footer: shown.length ? 'Add or remove it in a screen’s Pages.' : 'Not shown yet. Add it in a generated screen’s Pages.' },
        shown.map(function (x) { return K.nav({ label: x.title, value: 'Pages', href: '#/screens/' + encodeURIComponent(x.path) + '/pages' }); })));
      var cards = (p.view && p.view.cards) ? p.view.cards.length : 0;
      c.appendChild(K.group({}, [K.nav({ label: 'Page Content', value: cards + ' Card' + (cards === 1 ? '' : 's'), href: '#/pages/' + p.path + '/content' })]));
      if (shown.length) {
        c.appendChild(K.group({}, [K.nav({ label: 'Open Page', sub: 'On ' + shown[0].title, href: '/' + shown[0].path + '/' + p.path, icon: 'mdi:open-in-new' })]));
        var a = c.lastChild.querySelector('a'); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener');
      }
      c.appendChild(K.group({}, [K.button({ label: 'Delete Page…', destructive: true, sk: 'pg:delete', onClick: function () {
        K.confirm(self.shadowRoot, { title: 'Delete ' + p.title + '?', ok: 'Delete', destructive: true,
          message: shown.length ? shown.length + ' screen' + (shown.length > 1 ? 's show' : ' shows') + ' it; it will be gone from ' + (shown.length > 1 ? 'them' : 'it') + '.' : 'No screen shows it.' })
          .then(function (yes) {
            if (!yes) return;
            self.ws({ type: 'config_entries/subentries/delete', entry_id: self.data.entry_id, subentry_id: p.item }).then(function (ok) {
              if (ok) self.reload().then(function () { self.go('#/pages'); });
            });
          });
      } })]));
    }
    pg_new(c) {
      var self = this, np = this._pgn = this._pgn || { title: '', path: '', icon: '', start: 'blank' };
      if (!this._starts) {
        this._starts = [['blank', 'A Blank Page']];
        var base = 'config/config_entries/subentries/flow';
        this.rest('POST', base, { handler: [this.data.entry_id, 'page'] }).then(function (r) {
          self.rest('DELETE', base + '/' + r.flow_id).catch(function () {});
          var f = (r.data_schema || []).filter(function (x) { return x.name === 'start'; })[0];
          var opts = f && f.selector && f.selector.select && f.selector.select.options || [];
          self._starts = opts.map(function (o) { return [o.value, o.value === 'blank' ? 'A Blank Page' : o.label]; });
          self.render();
        }).catch(function () {});
      }
      c.appendChild(K.group({}, [
        K.text({ label: 'Name', sk: 'pgn:title', value: np.title, placeholder: 'Energy', maxlength: 40, onCommit: function (v) { np.title = v; self.render(); } }),
        K.text({ label: 'Address', sk: 'pgn:path', value: np.path, placeholder: slug(np.title) || 'energy', maxlength: 40, onCommit: function (v) { np.path = v; } }),
        K.text({ label: 'Icon', sk: 'pgn:icon', value: np.icon, placeholder: 'mdi:lightning-bolt', maxlength: 60, onCommit: function (v) { np.icon = v; } }),
        K.select({ label: 'Start From', sk: 'pgn:start', value: np.start, options: this._starts, onChange: function (v) { np.start = v; } })]));
      if (this.err('pgn')) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('pgn') }));
      c.appendChild(K.group({ footer: 'Start from a page of another dashboard to copy its cards. You can edit them afterwards.' }, [
        K.button({ label: 'Create Page', center: true, disabled: !np.title.trim(), fk: 'pgn:go', onClick: function () {
          self.status('saving');
          self.addPage(np).then(function (path) {
            self._pgn = null; delete self.errors.pgn; self.status('saved');
            return self.reload().then(function () { self.go('#/pages/' + path); });
          }, function (e) { self.errors.pgn = String(e && e.message || e); self.status('error'); self.render(); });
        } })]));
    }
    async addPage(np) {
      var base = 'config/config_entries/subentries/flow';
      var r = await this.rest('POST', base, { handler: [this.data.entry_id, 'page'] });
      var fid = r.flow_id;
      try {
        var first = { title: np.title.trim(), start: np.start || 'blank' };
        if (np.path.trim()) first.path = np.path.trim();
        if (np.icon.trim()) first.icon = np.icon.trim();
        r = await this.rest('POST', base + '/' + fid, first);
        if (r.step_id === 'user') throw new Error(M.errorText(Object.keys(r.errors || {}).map(function (k) { return r.errors[k]; })[0]));
        // the view step holds the imported (or blank) page: submit it as it is
        var vf = (r.data_schema || []).filter(function (x) { return x.name === 'view'; })[0];
        var view = vf && vf.description && vf.description.suggested_value || { cards: [] };
        r = await this.rest('POST', base + '/' + fid, { view: view });
        if (r.type !== 'create_entry') throw new Error(M.errorText(Object.keys(r.errors || {}).map(function (k) { return r.errors[k]; })[0]));
        return (r.result && r.result.unique_id) || first.path || slug(first.title);
      } catch (e) {
        this.rest('DELETE', base + '/' + fid).catch(function () {});
        throw e;
      }
    }

    // ---------------------------------------------------------- system
    p_advanced() {
      var self = this;
      return { title: 'Advanced', top: true, scope: 'What almost nobody changes. Everything here works when left empty.', body: function (c) {
        var set = function (k) { return function (v) { var o = {}; o[k] = v; self.setH(o); }; };
        var I = self.data.integration || {}, f = I.files || {};
        c.appendChild(K.group({ header: 'Clock', footer: 'Home Assistant’s Time & Date sensors keep every screen’s clock in step with the house.' }, [
          self.entityRow({ label: 'Time Sensor', sk: 'clock.time', value: self.hs('clock.time'), none: 'Each Screen’s Own Clock', filter: { domains: ['sensor'] }, onPick: set('clock.time') }),
          self.entityRow({ label: 'Date Sensor', sk: 'clock.date', value: self.hs('clock.date'), none: 'Each Screen’s Own Clock', filter: { domains: ['sensor'] }, onPick: set('clock.date') })]));
        // (the Clean-Areas Script and the Wrong-Code Indicator are the
        // Vacuums and Security pages' since 2026-10-16)
        c.appendChild(K.group({ header: 'HK Settings', footer: 'Off: HK Settings leaves the sidebar for everyone. It’s still in ' + haPlace('Settings → Devices & Services → HK Frontend → Configure') + '.' }, [
          K.toggle({ label: 'Show in Sidebar', sk: 'sidebar', on: I.sidebar !== false, onChange: function (on) { self.setH({ sidebar: on }); } })]));
        var fnd = function (v) { return v ? 'Found' : 'Missing'; };
        c.appendChild(K.group({ header: 'Your Files', footer: 'Apple’s SF Pro font and the SF Symbols glyphs can’t ship with the integration. Put the font at fonts/SF-Pro.woff2 and the glyphs at iconset/hk-glyphs.js in this folder, under /config.' }, [
          K.text({ label: 'Folder', sk: 'files_folder', value: I.files_folder, placeholder: 'hk_local', error: self.err('files_folder'),
                   onCommit: function (v) { self.setH({ files_folder: v }); } }),
          K.info({ label: 'SF Pro Font', value: fnd(f.font), valueCls: f.font ? 'ok' : 'warn' }),
          K.info({ label: 'SF Symbols Glyphs', value: fnd(f.glyphs), valueCls: f.glyphs ? 'ok' : 'warn' })]));
        c.appendChild(K.group({ header: 'Your Own Dashboards', footer: 'What a dashboard you write yourself can use, ready to copy: ' +
            'the screensaver, hiding Home Assistant’s header, the live sky, HK cards and more.' }, [
          K.nav({ label: 'YAML Reference', href: '#/advanced/yaml', sk: 'yaml-ref',
                  value: M.YAML_REF.reduce(function (n, g) { return n + g.items.length; }, 0) + ' Snippets' })]));
        c.appendChild(K.group({}, [K.nav({ label: 'Setup Assistant', href: '#/setup' })]));
      } };
    }
    // YOUR OWN DASHBOARDS: every snippet of M.YAML_REF, filled in from this
    // house where it can be, each on its own page with Copy and its place in
    // the wiki (docs/Your-Own-Dashboard.md holds the same text).
    p_yamlRef(id) {
      var self = this, list = ['Your Own Dashboards', '#/advanced/yaml'];
      // its place in the documentation, where the host has it ([] where not)
      var wiki = function (anchor) {
        var a = docsLink('Your-Own-Dashboard', anchor, { sub: 'Your Own Dashboard', fk: 'yaml:wiki' });
        return a ? [a] : [];
      };
      var item = id ? M.yamlRefItem(decodeURIComponent(id)) : null;
      if (!item) {
        return { title: 'Your Own Dashboards', back: ['Advanced', '#/advanced'],
          scope: 'What a dashboard you write yourself can use. Open one, copy it, and paste it into the dashboard’s YAML.', body: function (c) {
            c.appendChild(K.group({ footer: 'Easier still: HK Settings → Screens → Add Screen → Existing Dashboards gives a dashboard ' +
                'its menu, its screensaver and Hide Home Assistant Header & Sidebar, with nothing written.' }, wiki('')));
            M.YAML_REF.forEach(function (g) {
              c.appendChild(K.group({ header: g.header, footer: g.footer }, g.items.map(function (it) {
                return K.nav({ label: it.title, value: it.key, href: '#/advanced/yaml/' + encodeURIComponent(it.id), fk: 'yaml:' + it.id });
              })));
            });
          } };
      }
      var boards = this.data.boards || {};
      var tbs = this.tabs();
      var user = Object.keys(tbs).map(function (k) { return tbs[k].user; }).filter(Boolean)[0];
      var text = M.yamlRefText(item, { weather: this.hs('weather.entity'), user: user, photos: this.hs('look.photos') });
      var group = M.YAML_REF.filter(function (g) { return g.items.indexOf(item) >= 0; })[0];
      return { title: item.title, back: list, body: function (c) {
        var pre = h('pre', { class: 'code', text: text, tabindex: '0', 'aria-label': item.title + ', in YAML' });
        c.appendChild(K.group({ header: group ? group.header : null, footer: item.sub + (group ? ' ' + group.footer : '') }, [
          K.button({ label: 'Copy', fk: 'yaml:copy', onClick: function () {
            var done = function () { self.announce('Copied'); };
            var fallback = function () {
              var r = document.createRange(); r.selectNodeContents(pre);
              var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
              self.announce('Selected — copy it with your keyboard');
            };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
            else fallback();
          } })]));
        c.appendChild(pre);
        if (wiki(item.anchor).length) c.appendChild(K.group({}, wiki(item.anchor)));
      } };
    }
    p_check() {
      var self = this;
      return { title: 'Setup Check', top: true, scope: 'What these pages need from this Home Assistant, and how to fix what’s missing.', body: function (c) {
        var lines = self._check;
        if (!lines) {
          c.appendChild(K.group({}, [K.info({ label: 'Checking…' })]));
          if (!self._checking) {
            self._checking = true;
            self.client.callWS({ type: DOMAIN + '/setup/check' }).then(function (r) { self._check = r.lines; self._checking = false; self.render(); },
              function (e) { self._checking = false; self._check = [{ ok: false, title: 'Setup check failed', detail: String(e && e.message || e) }]; self.render(); });
          }
          return;
        }
        var ic = function (ok) { return ok === true ? ['mdi:check', C.green] : ok === false ? ['mdi:exclamation', C.orange] : ['mdi:information-variant', C.gray]; };
        var groups = [['Needs Doing', false], ['Ready', true], ['Notes', null]];
        groups.forEach(function (g) {
          var ls = lines.filter(function (l) { return l.ok === g[1]; });
          if (!ls.length) return;
          c.appendChild(K.group({ header: g[0] }, ls.map(function (l) {
            // a line may carry a [link](/where) to fix it: the row opens it.
            // ONLY A PATH ON THIS SERVER becomes the row's href -- the names in
            // a line come from integrations (setup_check escapes them), and a
            // javascript: or off-site link must never be one click away.
            var text = String(l.detail || '').replace(/(?<!\\)[*`]/g, ''), link = null;
            text = text.replace(/(?<!\\)\[([^\]]+)\]\(([^)\s]+)\)/g, function (_m, words, url) {
              if (!link && /^\/(?!\/)/.test(url)) link = url;
              return words;
            }).replace(/\\([\\`*_\[\]()<>])/g, '$1');
            if (link) return K.nav({ tile: ic(l.ok), label: l.title, sub: text, href: link });
            return K.info({ tile: ic(l.ok), label: l.title, sub: text });
          })));
        });
        c.appendChild(K.group({}, [K.button({ label: 'Check Again', fk: 'check:again', onClick: function () { self._check = null; self.render(); } })]));
      } };
    }
    // THE SETUP ASSISTANT'S FEATURES STEP: the optional features, each as
    // this house has it -- added (its page) or not (Add, through HK Frontend's
    // Add feature).
    // THE SETUP ASSISTANT'S ALARM (General's, until 2026-10-16; the
    // Security page's under Pages now)
    setupAlarm(c) {
      var self = this, set = function (v) { self.setH({ 'security.alarm': v }); };
      var sugg = !this.hs('security.alarm') && (this.data.suggest || {}).alarm;
      c.appendChild(K.group({ footer: 'The header’s security line, the Security chip and page, and the alarm keypad. Later: Pages → Security.' }, [
        this.entityRow({ label: 'Alarm Panel', sk: 'security.alarm', value: this.hs('security.alarm'), none: 'No Alarm',
                         filter: { domains: ['alarm_control_panel'] }, onPick: set }),
        sugg ? K.button({ label: 'Use ' + this.name(sugg), fk: 'alarm:suggest', onClick: function () { set(sugg); } }) : null]));
    }
    setupFeatures(c) {
      var feats = this.data.features || {}, rows = [], missing = [];
      F.LIST.forEach(function (x) {
        var st = F.stateOf(feats, x[1]), name = (feats[x[1]] || {}).name || x[2];
        if (st === 'added' || x[0] === 'music') {
          rows.push(K.nav({ tile: [x[3], x[4]], label: x[2], sub: F.SCOPE[x[1]],
                            href: '#/features/' + x[0], fk: 'setup:feat:' + x[0] }));
        }
        if (st === 'not_added') {
          rows.push(K.nav({ tile: [x[3], x[4]], label: 'Add ' + name, sub: F.SCOPE[x[1]], href: F.addHref(x[1]),
                            fk: 'setup:add:' + x[1] }));
        }
        if (st === 'missing') missing.push(name);
      });
      c.appendChild(K.group({ footer: 'Each is optional, added from ' + haName('HK Frontend’s Add feature') + '. Its settings are on its page under Pages (Notifications: All Screens).' +
          (missing.length ? ' Not available here: ' + missing.join(', ') + '.' : '') }, rows));
    }
    p_setup(step) {
      var self = this;
      var STEPS = SETUP_STEPS;
      step = Math.max(0, Math.min(STEPS.length - 1, step || 0));
      var next = function () { self.go('#/setup/' + (step + 1)); };
      return { title: step ? STEPS[step] : 'Set Up ' + PN(), backLabel: 'Setup',
        back: step ? [STEPS[step - 1], '#/setup/' + (step - 1)] : [this.title(), '#/'],
        scope: step && step < STEPS.length - 1 ? 'Step ' + step + ' of ' + (STEPS.length - 2) + '. Everything here can be changed later.' : null,
        body: function (c) {
          if (step === 0) {
            c.appendChild(h('div', { class: 'big' }, [h('span', { class: 'tile', style: 'background:' + C.orange }, K.icon('mdi:home-heart', '')),
              h('p', { text: 'A few questions about your home — its alarm, its weather, how the glass should look — then a first screen, built from your rooms and devices. Everything else is found by itself.' })]));
            c.appendChild(K.group({}, [K.button({ label: 'Get Started', center: true, fk: 'setup:go', onClick: next })]));
            return;
          }
          if (step === 1) self.setupAlarm(c);
          if (step === 2) self.h_weather(c);
          if (step === 3) self.h_appearance(c);
          if (step === 4) self.setupFeatures(c);
          if (step === SETUP_FIRST) {
            self.addScreenBody(c, null, function (path) { self._created = path; next(); });
            c.appendChild(K.group({}, [K.button({ label: 'Skip', center: true, fk: 'setup:skip', onClick: next })]));
            return;
          }
          if (step === SETUP_STEPS.length - 1) {
            c.appendChild(h('div', { class: 'big' }, [h('span', { class: 'tile', style: 'background:' + C.green }, K.icon('mdi:check', '')),
              h('p', { text: 'Your settings are saved. Everything can be changed later, from the list.' })]));
            if (self._created) {
              var a = K.nav({ label: 'Open ' + self._created, href: '/' + self._created + '/0', icon: 'mdi:open-in-new' });
              c.appendChild(K.group({}, [a]));
            }
            c.appendChild(K.group({}, [K.button({ label: 'Done', center: true, fk: 'setup:done', onClick: function () {
              self.go(self.hasAttribute('wide') ? '#/overview' : '#/');
            } })]));
            if (!self._setupMarked) {
              self._setupMarked = true;
              self.actions().callWS({ type: DOMAIN + '/setup/done', done: true }).catch(function () {});
            }
            return;
          }
          c.appendChild(K.group({}, [K.button({ label: 'Continue', center: true, fk: 'setup:next', onClick: next })]));
        } };
    }
  }
  var SETUP_STEPS = ['Welcome', 'Security System', 'Weather', 'Appearance', 'Features', 'First Screen', 'Done'];
  var SETUP_FIRST = SETUP_STEPS.indexOf('First Screen');
  var PIN_KEY = 'hk-preview-pinned';
  function pinnedPreview() { try { return localStorage.getItem(PIN_KEY) === '1'; } catch (e) { return false; } }
  function pinPreview(on) { try { if (on) localStorage.setItem(PIN_KEY, '1'); else localStorage.removeItem(PIN_KEY); } catch (e) { /* private */ } }
  function hashOf(h) { h = String(h || '#/').split('?')[0]; return h.charAt(0) === '#' ? h : '#' + h; }
  var FROM_KEY = 'hk-settings-from';
  function loadFrom() {
    try { var o = JSON.parse(sessionStorage.getItem(FROM_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; }
    catch (e) { return {}; }
  }
  function saveFrom(o) { try { sessionStorage.setItem(FROM_KEY, JSON.stringify(o)); } catch (e) { /* private window */ } }
  function slug(t) {
    return String(t || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }
  window.hkHostClient.entry(HkSettingsPanel);
  customElements.define('hk-settings-panel', HkSettingsPanel);
  window.hkSettingsPanel = { version: '2.0.0' };
})();
