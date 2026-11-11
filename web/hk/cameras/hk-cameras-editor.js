// hk-cameras-editor.js - the camera mosaic's editor.
//
// PART OF THE CAMERA CARDS (hk-cameras.js). Not a card and not run on its own: it registers one
// function, which hk-cameras.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkCamerasParts = window.hkCamerasParts || {})['hk-cameras-editor'] = function (K) {
    var hkEditor = K.hkEditor;

    // ---- editor -----------------------------------------------------------
    // A CUSTOM EDITOR, because ha-form cannot express this config. The scalars
    // (selector, height, seam) are a plain schema and go through hkEditor like
    // every other card here; the CAMERA LIST is an ordered list of objects with
    // add / remove / move, and `ha-form` has no selector for that.
    //
    // Built from plain <select>/<input>/<button> rather than ha-entity-picker and
    // friends. Those are nicer, but they are HA frontend internals with no
    // compatibility promise, and depending on undocumented behaviour has
    // cost this file before. A dropdown of camera entities is enough for a
    // strip of cameras.
    //
    // THE `option` FIELD IS A DROPDOWN OF THE SELECTOR'S OWN OPTIONS, not free
    // text. It has to match what the selector reports or that camera can
    // never be the live one -- a typo there fails silently and looks like a
    // broken camera. Reading the options off the entity makes it unmissable.
    class HkCameraMosaicEditor extends HTMLElement {
      setConfig(config) {
        this._config = Object.assign({ cameras: [] }, config);
        if (!Array.isArray(this._config.cameras)) this._config.cameras = [];
        this._build();
      }
      // EACH NEW CLIENT, through the host adapter's entry (below the class): the
      // schema form gets what goes with it. Only the pickers depend on the
      // client; rebuilding on every new one would throw away focus mid-typing.
      _onClient(c) {
        if (this._form) window.hkHostClient.bridge(this._form, c);
        if (!this._builtOnce) this._build();
      }

      _emit() {
        var cfg = Object.assign({}, this._config);
        cfg.cameras = (cfg.cameras || []).filter(function (c) { return c && c.entity; });
        this.dispatchEvent(new CustomEvent('config-changed', {
          detail: { config: cfg }, bubbles: true, composed: true
        }));
      }

      _cameraEntities() {
        var h = this.client;
        if (!h) return [];
        return Object.keys(h.states).filter(function (e) {
          return e.indexOf('camera.') === 0;
        }).sort();
      }
      _selectorOptions() {
        var h = this.client, sel = this._config && this._config.selector;
        if (!h || !sel || !h.states[sel]) return [];
        return (h.states[sel].attributes.options || []).slice();
      }

      _build() {
        if (!this._config) return;
        this._builtOnce = true;
        this.textContent = '';
        var self = this;

        // scalars, via the shared schema editor
        this._form = document.createElement(hkEditor('hk-camera-mosaic-card', [
          // NOT required: with none the first camera is the live one. Either
          // kind of list picks it (_selector reads its state and options).
          { name: 'selector', label: 'Live Camera Follows',
            selector: { entity: { filter: { domain: ['input_select', 'select'] } } },
            helper: 'A list whose choice is the camera shown live. Empty: the first camera.' },
          { type: 'grid', name: '', schema: [
            { name: 'own_cameras', label: 'Use These Cameras', selector: { boolean: {} },
              helper: 'On: this card\'s cameras, not the screen\'s camera list in HK Settings.' },
            { name: 'stills_only', label: 'Snapshots Only', selector: { boolean: {} } },
            { name: 'height', selector: { number: { min: 80, max: 400, step: 0.5, mode: 'box' } },
              helper: 'Strip height in px.' },
            { name: 'refresh', selector: { number: { min: 0, max: 120, step: 1, mode: 'box' } } },
            { name: 'seam', selector: { number: { min: 0, max: 12, step: 1, mode: 'box' } } },
            { name: 'radius', selector: { text: {} }, helper: 'Default 23.5px.' }
          ] }
        ]));
        window.hkHostClient.bridge(this._form, this.client);
        this._form.setConfig(this._config);
        this._form.addEventListener('config-changed', function (ev) {
          ev.stopPropagation();
          // keep the camera list, which that form knows nothing about
          var cams = self._config.cameras;
          self._config = Object.assign({}, ev.detail.config);
          self._config.cameras = cams;
          self._emit();
        });
        this.appendChild(this._form);

        var wrap = document.createElement('div');
        wrap.style.cssText = 'margin-top:14px';
        var h4 = document.createElement('div');
        h4.textContent = 'Cameras, in order. For each: the camera, the selector option that makes it live, and a name. A tap opens the camera\'s sheet.';
        h4.style.cssText = 'font-weight:600;margin:0 0 8px 0;opacity:.85';
        wrap.appendChild(h4);

        var ents = this._cameraEntities();
        var opts = this._selectorOptions();
        (this._config.cameras || []).forEach(function (cam, i) {
          wrap.appendChild(self._row(cam, i, ents, opts));
        });

        var add = document.createElement('button');
        add.textContent = '+ Add camera';
        add.style.cssText = 'margin-top:8px;padding:6px 12px;cursor:pointer';
        add.addEventListener('click', function () {
          self._config.cameras = (self._config.cameras || []).concat(
            [{ name: '', option: '', entity: '' }]);
          self._build(); self._emit();
        });
        wrap.appendChild(add);
        this.appendChild(wrap);
      }

      _row(cam, i, ents, opts) {
        var self = this;
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';

        var ent = document.createElement('select');
        ent.style.cssText = 'flex:2 1 0;min-width:0';
        [''].concat(ents).forEach(function (e) {
          var o = document.createElement('option');
          o.value = e; o.textContent = e || '— pick a camera —';
          if (e === cam.entity) o.selected = true;
          ent.appendChild(o);
        });
        ent.addEventListener('change', function () {
          cam.entity = ent.value; self._emit();
        });

        var opt = document.createElement('select');
        opt.style.cssText = 'flex:1 1 0;min-width:0';
        [''].concat(opts).forEach(function (o1) {
          var o = document.createElement('option');
          o.value = o1; o.textContent = o1 || '— selector option —';
          o.title = 'The selector option that shows this camera live';
          if (o1 === cam.option) o.selected = true;
          opt.appendChild(o);
        });
        opt.addEventListener('change', function () {
          cam.option = opt.value;
          if (!cam.name) cam.name = opt.value;
          self._emit();
        });

        var nm = document.createElement('input');
        nm.type = 'text'; nm.placeholder = 'name';
        nm.value = cam.name || '';
        nm.style.cssText = 'flex:1 1 0;min-width:0';
        nm.addEventListener('input', function () { cam.name = nm.value; self._emit(); });

        function btn(label, title, fn) {
          var b = document.createElement('button');
          b.textContent = label; b.title = title;
          b.style.cssText = 'padding:4px 8px;cursor:pointer';
          b.addEventListener('click', fn);
          return b;
        }
        var up = btn('↑', 'Move up', function () { self._move(i, -1); });
        var dn = btn('↓', 'Move down', function () { self._move(i, 1); });
        var rm = btn('✕', 'Remove', function () {
          self._config.cameras.splice(i, 1); self._build(); self._emit();
        });
        up.disabled = i === 0;
        dn.disabled = i === (this._config.cameras.length - 1);

        row.append(ent, opt, nm, up, dn, rm);
        return row;
      }

      _move(i, d) {
        var a = this._config.cameras, j = i + d;
        if (j < 0 || j >= a.length) return;
        var t = a[i]; a[i] = a[j]; a[j] = t;
        this._build(); this._emit();
      }
    }

    // what the shell and the later parts use of this one
    K.HkCameraMosaicEditor = HkCameraMosaicEditor;
  };
})();
