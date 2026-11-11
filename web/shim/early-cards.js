// early-cards.js -- the card list is asked for, and the cards' files start downloading, with the page.
//
// NO STARTUP WATERFALL (2026-10-29). home.js asked for GET /api/hk-cards only once its own modules (about
// twenty, from the top of its imports) had arrived and run, and began fetching the cards only after the house's
// states had come and the seven bootstrap modules had each run in turn. This runs as soon as base.js is here
// (the html lists it before home.js): it asks for the list at once, keeps the answer for home.js to take
// (window.__mantelCardList), and as the list arrives adds a modulepreload for each card. A modulepreload only
// DOWNLOADS: nothing runs until home.js imports the card, in the same order as before (the hk-boot docstring in
// hosts/ha/custom_components/hk_frontend/boot.py is why that order matters). Failing here changes nothing:
// home.js asks again itself.
//
// ONLY THE CARDS A SCREEN USES (2026-10-29): the answer is {core, lazy} (mantel_server/hk_cards.py). Only the
// core files are preloaded; the lazy ones wait until a card of theirs is asked for (hk-loader.js hkNeed).
// @ts-check
import { mantelUrl, hkV } from './base.js';

const list = fetch(mantelUrl('/api/hk-cards')).then((r) => {
  if (!r.ok) throw new Error('hk-cards ' + r.status);
  return r.json();
});
window.__mantelCardList = list;
list.then((cards) => {
  for (const c of cards.core || []) {
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = hkV('/hk/cards/' + c);       // the address home.js imports it at (the build's ?v=, base.js)
    document.head.appendChild(link);
  }
  // A FILE CUT INTO PARTS (tools/split_js.py) fetches them a round trip after itself: they download with it instead --
  // hk-base.js's, hk-strategy.js's, the core cards' (phase 24, B8). Each is a path under /hk/, joined here to the literal
  // '/hk/', which the server moves under Ingress's prefix as it does every other address in this file.
  for (const list of Object.values(cards.parts || {})) {
    for (const rel of list) {
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = hkV('/hk/' + rel);
      document.head.appendChild(link);
    }
  }
}).catch(() => { /* home.js asks for the list again, and says what went wrong */ });
