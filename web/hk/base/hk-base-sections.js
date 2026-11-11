// hk-base-sections.js - the grid in sections, defining a card (register) and morph().
//
// PART OF THE CARDS' FOUNDATION (hk-base.js). Not a card and not run on its own: it registers one
// function, which hk-base.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkBaseParts = window.hkBaseParts || {})['hk-base-sections'] = function (K) {
    var asClient = K.asClient, edges = K.edges, hkEditor = K.hkEditor;

    // ---------------------------------------------------- SIZES IN SECTIONS
    // What each card asks HA's Sections view for (getGridOptions): of the
    // section's 12 columns, the tiles half, so two sit side by side and fill
    // it; the whole-page cards (the header, rows, the Music page, the
    // calendar...) the full width; the rest a full column they can be
    // narrowed from. Rows are always 'auto': every card has its own height.
    // The user's own size in the card's Layout tab wins, as for any card.
    // HK's own grid view never asks.
    function gridOf(columns, min) {
      return columns === 'full' ? { columns: 'full', rows: 'auto' }
                                : { columns: columns, rows: 'auto', min_columns: min || 3 };
    }
    var GRID = {};
    function sizeAs(o, tags) { tags.forEach(function (t) { GRID[t] = o; }); }
    // everything else (the controls, keypads, players, graphs, New Timer...)
    var GRID_REST = gridOf(12, 6);
    function gridFor(tag) { return GRID[tag] || GRID_REST; }
    // ON THE PROTOTYPE, unless the card has its own. register() and
    // wireEditor() do it; a card that defines itself calls hkCards.sized
    // just before its customElements.define.
    function sized(tag, Ctor) {
      if (!Ctor || !Ctor.prototype || Object.prototype.hasOwnProperty.call(Ctor.prototype, 'getGridOptions')) return;
      var o = gridFor(tag);
      Ctor.prototype.getGridOptions = function () { return Object.assign({}, o); };
    }
    // ------------------------------------------------ defining a card
    // register(): define the element, wire its editor from a schema, give the
    // picker a stub, list it in the card picker. Every card file uses it.
    function register(tag, Ctor, name, description, schema, stub) {
      sized(tag, Ctor);
      if (!customElements.get(tag)) customElements.define(tag, Ctor);
      if (schema) {
        var etag = hkEditor(tag, schema);
        Ctor.getConfigElement = function () { return document.createElement(etag); };
      }
      // hasOwnProperty, NOT a truthiness check: these cards EXTEND one another,
      // so HkLightCard inherits HkTileCard's static getStubConfig through the
      // prototype chain and a plain `!Ctor.getStubConfig` guard reads as "already
      // has one". The picker would then offer a switch as the stub for the light,
      // fan and cover cards.
      if (stub && !Object.prototype.hasOwnProperty.call(Ctor, 'getStubConfig')) {
        Ctor.getStubConfig = clientStub(stub);
      }
      window.customCards = window.customCards || [];
      window.customCards.push({ type: tag, name: name, description: description, preview: true });
    }

    // wireEditor(): editor + stub for a card that defines ITSELF (the older,
    // purpose-built cards call customElements.define in their own section).
    function wireEditor(tag, Ctor, schema, stub) {
      sized(tag, Ctor);
      if (!Object.prototype.hasOwnProperty.call(Ctor, 'getConfigElement')) {
        var etag = hkEditor(tag, schema);
        Ctor.getConfigElement = function () { return document.createElement(etag); };
      }
      if (stub && !Object.prototype.hasOwnProperty.call(Ctor, 'getStubConfig')) {
        Ctor.getStubConfig = clientStub(stub);
      }
    }
    // THE PICKER'S STUB GETS A CLIENT. Lovelace calls getStubConfig with its own
    // object; the stub is shared code, so it is handed the client made from it
    // (the host adapter's), and reads `client.states` like every card.
    function clientStub(stub) {
      return function (input) { return stub(asClient(input)); };
    }

    // The picker calls getStubConfig to build its preview, so it has to name an
    // entity that actually exists in THIS house or the preview renders empty.
    function firstOf(client, domain) {
      var ids = client && client.states ? Object.keys(client.states) : [];
      for (var i = 0; i < ids.length; i++) {
        if (ids[i].indexOf(domain + '.') === 0) return ids[i];
      }
      return domain + '.example';
    }

    // ------------------------------------------------ morph(): update in place
    // Bring `el`'s children in line with `html` by CHANGING what differs -- a
    // text node's value, an attribute -- and replacing a node only where the
    // structure itself changed. Never `el.innerHTML = html` for something that
    // re-renders on a timer.
    //
    // WHY. A wall header that rebuilds its whole clock + weather block every
    // minute via innerHTML flickers: on a tablet's Android WebView, recreating
    // the elements -- the SVG glyph, the drop-shadowed text -- recreates their
    // compositing layers, once a minute, when the clock ticks. morph() turns the minute
    // tick into a single text-node change.
    function morph(el, html) {
      var tpl = document.createElement('template');
      tpl.innerHTML = html;
      syncChildren(el, tpl.content);
      // (a scrolling list's edges, SCROLL EDGES: the sync took their marks off)
      edges(el);
    }
    function syncChildren(live, next) {
      var want = Array.prototype.slice.call(next.childNodes);
      for (var i = 0; i < want.length; i++) {
        var cur = live.childNodes[i];
        if (!cur) { live.appendChild(want[i]); continue; }
        if (!syncNode(cur, want[i])) live.replaceChild(want[i], cur);
      }
      while (live.childNodes.length > want.length) live.removeChild(live.lastChild);
    }
    function syncNode(cur, want) {
      if (cur.nodeType !== want.nodeType || cur.nodeName !== want.nodeName) return false;
      if (cur.nodeType === 3 || cur.nodeType === 8) {
        if (cur.nodeValue !== want.nodeValue) cur.nodeValue = want.nodeValue;
        return true;
      }
      if (cur.nodeType !== 1) return false;
      var i, a;
      for (i = cur.attributes.length - 1; i >= 0; i--) {
        a = cur.attributes[i].name;
        if (!want.hasAttribute(a)) cur.removeAttribute(a);
      }
      for (i = 0; i < want.attributes.length; i++) {
        a = want.attributes[i];
        if (cur.getAttribute(a.name) !== a.value) cur.setAttribute(a.name, a.value);
      }
      // (DATA-KEEP: its children are its own -- a card mounted in it, the Timers block's maker, 2026-11-09)
      if (!(cur.hasAttribute('data-keep') && want.hasAttribute('data-keep'))) syncChildren(cur, want);
      return true;
    }

    // what the shell and the later parts use of this one
    K.firstOf = firstOf; K.gridFor = gridFor; K.gridOf = gridOf; K.morph = morph; K.register = register;
    K.sizeAs = sizeAs; K.sized = sized; K.wireEditor = wireEditor;
  };
})();
