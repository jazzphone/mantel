// player_look.js - the one look every music player is held to (2026-11-07, the owner: "Probably should do it across
// the board ... have everything follow this similar layout too as close as possible", after the Now Playing page's
// mockup, docs/mockups/now-playing-page.html).
//
// Evaluated in a page by the checks that open each player (music_pane_check, side_pane_check, sheet_review,
// grid_music_turn_check, media_card_check); it defines window.playerLook(root, o). Required from Node it is that
// function (module.exports), for a page whose CSP refuses a script: page.evaluate takes a function made from it.
//   root  the player's element or shadow root; o.bar, o.pp, o.vol, o.buttons are selectors looked up through
//         shadow roots below it
//   o.pp  the play / pause GLYPH (an svg or hk-icon whose 24-unit drawing is a pause from y 5 to 19, as every
//         player's is), o.bar the progress bar, o.vol the volume's track or the slider round it (its middle is the
//         track's: less 3 px, a 6 px track's half)
// Returns { above, below, wells }: above, from the progress bar to the pause glyph's ink; below, from that ink to
// the volume's track -- the two the same, give or take 3 px; wells, any button with something drawn behind its
// glyph (a background or a ring, on it or on its ::before / ::after), a button that is on excepted (its panel open).
(function (g) { function playerLook(root, o) {
  var deep = function (r, s) {
    var out = [];
    (function walk(n) {
      Array.prototype.forEach.call(n.querySelectorAll('*'), function (e) {
        if (e.matches(s)) out.push(e);
        if (e.shadowRoot) walk(e.shadowRoot);
      });
    })(r);
    return out;
  };
  var seen = function (e) { var b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  var one = function (s) { return s ? deep(root, s).filter(seen)[0] || null : null; };
  var bar = one(o.bar), pp = one(o.pp), vol = one(o.vol), out = { wells: [] };
  if (bar && pp && vol) {
    var p = pp.getBoundingClientRect(), v = vol.getBoundingClientRect();
    out.above = Math.round((p.top + p.height * 5 / 24 - bar.getBoundingClientRect().bottom) * 10) / 10;
    out.below = Math.round(((v.top + v.bottom) / 2 - 3 - (p.top + p.height * 19 / 24)) * 10) / 10;
  }
  var clear = function (c) { return !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c); };
  deep(root, o.buttons).filter(seen).forEach(function (b) {
    if (b.classList.contains('on') || b.classList.contains('lit')) return;
    [null, '::before', '::after'].forEach(function (pseudo) {
      var cs = getComputedStyle(b, pseudo);
      if (pseudo && (cs.content === 'none' || cs.content === 'normal')) return;
      if (!clear(cs.backgroundColor) || (cs.boxShadow && cs.boxShadow !== 'none') || cs.backgroundImage !== 'none') {
        out.wells.push((String(b.className) || b.tagName) + (pseudo || '') + ': ' + cs.backgroundColor + ' / ' + cs.boxShadow);
      }
    });
  });
  return out;
} if (typeof module !== 'undefined' && module.exports) module.exports = playerLook; else g.playerLook = playerLook; })(this);
