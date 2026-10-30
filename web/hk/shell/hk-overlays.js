// HK's own toast layer (Phase 2 P2.5, docs/phase2/SHEETS.md).
//
// HK asks for a toast through the host shell (hkShell.toast): the host's toast event, bubbling and
// composed from the card that spoke (or the shell's root). A host that draws that event itself says
// so (hkShell.hostToast(): Home Assistant, whose snackbar HK's toasts have always been); for any other
// host (Mantel) this layer draws it, once the event reaches the window -- a page of HK's that shows a
// library's messages in its own place (the Music page, the screensaver's music panel) hears it on the
// way up and stops it, as before, so it never gets here.
//
// ONE AT A TIME, as Home Assistant's: a new toast replaces the one showing. detail: { message,
// duration (ms; 3000 when not given, 0 or less: until dismissed), action: { text, action() },
// dismissable }. It mounts in the host shell's dialog root (hkShell.dialogRoot(): Mantel's overlay
// root), above HK's sheets and dialogs, and never takes a tap outside its own plate.
//
// HK's confirm dialog is hk-base.js's confirmSheet (and chooseSheet), HK's own since before Phase 1;
// it mounts in the same dialog root.
(function (global) {
  'use strict';
  if (global.hkOverlays) return;

  var DEFAULT_MS = 3000;
  // OVER.solid (hk-base.js): the near-solid overlay, no blur -- a toast must read over anything
  var CSS = [
    '#hk-toasts{position:fixed;left:0;right:0;bottom:calc(24px + env(safe-area-inset-bottom, 0px));z-index:10001;',
    // (centred between the side safe areas -- the iPhone Duo's strip, a phone turned: hk-base.js SAFE)
    '  display:flex;justify-content:center;pointer-events:none;box-sizing:border-box;',
    '  padding:0 calc(16px + var(--hk-safe-right,env(safe-area-inset-right,0px))) 0 calc(16px + var(--hk-safe-left,env(safe-area-inset-left,0px)))}',
    '#hk-toasts .toast{pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:568px;min-width:0;',
    '  box-sizing:border-box;padding:12px 18px;border-radius:14px;background:rgba(24,24,28,0.93);color:#fff;',
    '  font:600 15px/1.35 -apple-system,"SF Pro Text",system-ui,sans-serif;',
    '  box-shadow:0 6px 24px rgba(0,0,0,0.4);transition:opacity .25s,transform .25s}',
    '#hk-toasts .toast.out{opacity:0;transform:translateY(8px)}',
    '#hk-toasts .msg{flex:1 1 auto;min-width:0}',
    '#hk-toasts button{appearance:none;border:0;background:none;color:#0a84ff;font:inherit;padding:4px 2px;',
    '  cursor:pointer;flex:0 0 auto;-webkit-tap-highlight-color:transparent}',
    '#hk-toasts button.x{color:rgba(255,255,255,0.6);font-size:18px;line-height:1}'
  ].join('');

  var layer = null, shown = null, timer = 0;

  function doc() { return global.document; }
  function shell() { return global.hkShell || null; }
  // where the layer mounts: the host shell's dialog root, else the body
  function root() {
    var sh = shell(), r = sh && sh.dialogRoot ? sh.dialogRoot() : null, d = doc();
    return r || (d && d.body) || null;
  }
  function el(tag, cls, text) {
    var e = doc().createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function ensure() {
    var r = root();
    if (!r) return null;
    if (!layer) {
      layer = el('div');
      layer.id = 'hk-toasts';
      layer.setAttribute('role', 'status');
      layer.setAttribute('aria-live', 'polite');
      layer.appendChild(el('style', null, CSS));
    }
    if (layer.parentNode !== r) r.appendChild(layer);
    return layer;
  }

  function dismiss() {
    if (timer) { clearTimeout(timer); timer = 0; }
    var t = shown;
    shown = null;
    if (!t || !t.el) return false;
    var e = t.el;
    e.classList.add('out');
    setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 260);
    return true;
  }

  function toast(detail) {
    var d = typeof detail === 'string' ? { message: detail } : (detail || {});
    if (d.message == null || d.message === '') return null;
    var L = ensure();
    if (!L) return null;
    if (shown) {
      // replaced at once: the old plate goes without its fade
      if (timer) { clearTimeout(timer); timer = 0; }
      if (shown.el.parentNode) shown.el.parentNode.removeChild(shown.el);
      shown = null;
    }
    var t = el('div', 'toast');
    t.appendChild(el('span', 'msg', String(d.message)));
    var act = d.action && d.action.text ? d.action : null;
    if (act) {
      var b = el('button', 'act', String(act.text));
      b.setAttribute('type', 'button');
      b.addEventListener('click', function () {
        dismiss();
        if (typeof act.action === 'function') { try { act.action(); } catch (e) { /* the caller's */ } }
      });
      t.appendChild(b);
    }
    var ms = d.duration == null ? DEFAULT_MS : Number(d.duration);
    if (d.dismissable || !(ms > 0)) {
      var x = el('button', 'x', '×');
      x.setAttribute('type', 'button');
      x.setAttribute('aria-label', 'Dismiss');
      x.addEventListener('click', function () { dismiss(); });
      t.appendChild(x);
    }
    L.appendChild(t);
    shown = { el: t, detail: d };
    if (ms > 0) timer = setTimeout(dismiss, ms);
    return t;
  }

  // THE HOST'S TOAST EVENT, heard on the window (bubbling: whoever stopped it on the way showed it
  // already), drawn only when the host does not draw it itself. Listened for by the shell's current
  // event name, again whenever a host installs itself.
  var heard = null;
  function onToast(e) {
    var sh = shell();
    if (!sh || sh.hostToast() || !e || e.defaultPrevented) return;
    toast(e.detail);
  }
  function listen() {
    var sh = shell();
    if (!sh || typeof global.addEventListener !== 'function') return;
    var name = sh.events.toast;
    if (name === heard) return;
    if (heard) global.removeEventListener(heard, onToast);
    heard = name;
    global.addEventListener(name, onToast);
  }
  listen();
  if (typeof global.addEventListener === 'function') global.addEventListener('hk-host-shell-ready', listen);

  global.hkOverlays = {
    toast: toast,
    dismiss: dismiss,
    root: root,
    // what is showing ({ el, detail }), or null -- for the tests and the smoke
    current: function () { return shown; },
    _: { CSS: CSS, DEFAULT_MS: DEFAULT_MS, layer: function () { return layer; } }
  };
})(globalThis);
