// hk-base-card.js - redrawing every card, and still now.
//
// PART OF THE CARDS' FOUNDATION (hk-base.js). Not a card and not run on its own: it registers one
// function, which hk-base.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkBaseParts = window.hkBaseParts || {})['hk-base-card'] = function (K) {
    var GEN = K.GEN, ST = K.ST;

    function redrawAll() {
      GEN.n++;
      ST.LIVE = ST.LIVE.filter(function (r) { return !!r.deref(); });
      ST.LIVE.forEach(function (r) {
        var el = r.deref();
        if (el && el.isConnected && el._config && el.client) {
          try { el.requestUpdate(); } catch (e) { console.error('[hk-cards] wake', e); }
        }
      });
    }
    // ...and whether this screen's Animations are off (hk-still): read from
    // its Sky / Background whenever a setting or the page changes. The cards
    // whose glyph spins (hk-tile.js, hk-chip.js) stand it upright then; a
    // class here in BASE_CSS would reach every card's own .spin.
    function stillNow() {
      var S = window.hkSettings;
      try { return !!(S && S.skyLook && S.skyLook().animations === false); } catch (e) { return false; }
    }

    // what the shell and the later parts use of this one
    K.redrawAll = redrawAll; K.stillNow = stillNow;
  };
})();
