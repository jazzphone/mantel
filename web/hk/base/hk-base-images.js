// hk-base-images.js - a picture's image and when it is bad.
//
// PART OF THE CARDS' FOUNDATION (hk-base.js). Not a card and not run on its own: it registers one
// function, which hk-base.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkBaseParts = window.hkBaseParts || {})['hk-base-images'] = function (K) {
    var artBad = K.artBad, artFallback = K.artFallback;

    // HOW STALE A CACHED FRAME MAY BE BEFORE IT IS A LIE.
    //
    // The strip can show an old frame safely because it draws an AGE LABEL over
    // every tile -- "1m", "2h" -- so nothing is presented as live that is not.
    // The cameras page has no such label, and a picture of the front door from
    // three hours ago shown as if it were live is worse than a black tile for
    // the second it takes the stream to start. This is a security surface.
    //
    // So the page only uses a cached frame while it is FRESH, which in practice
    // means "the dashboard was on screen a moment ago" -- exactly the case where
    // the wait is most annoying. Past that it gets HA's own poster and black,
    // as it would with no cache at all.
    var SNAP_FRESH = 2 * 60 * 1000;
    var ART_BAD_MS = 30 * 1000;        // how long a failed address is not asked again
    // The address to put in the markup: the picture's own, unless it failed a moment ago
    function artSrc(url, o) {
      o = o || {};
      var at = artBad[url];
      if (at && Date.now() - at < ART_BAD_MS) return artFallback(url, o.ph || 'note', o.ini, o.color);
      if (at) delete artBad[url];
      return url;
    }
    function artImg(url, o) {
      o = o || {};
      var q = function (s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); };
      return '<img' + (o.cls ? ' class="' + q(o.cls) + '"' : '') + ' alt="" data-ph="' + (o.ph || 'note') + '"' +
        (o.ini != null ? ' data-initials="' + q(o.ini) + '"' : '') + (o.color ? ' data-color="' + q(o.color) + '"' : '') +
        (o.attrs ? ' ' + o.attrs : '') + ' src="' + q(artSrc(url, o)) + '">';
    }

    // what the shell and the later parts use of this one
    K.ART_BAD_MS = ART_BAD_MS; K.artImg = artImg; K.artSrc = artSrc; K.SNAP_FRESH = SNAP_FRESH;
  };
})();
