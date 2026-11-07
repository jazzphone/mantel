// hk-pairs.js - a stereo pair is one speaker on the generated dashboards.
//
// 2026-11-06, the owner: the Living Room showed its two HomePods, left and
// right, not the one pair set up in Mantel Settings -> Music. Home Assistant
// has no pair: Music Assistant gives each HomePod a player of its own, both in
// the room's area, and the pair is the music settings' (a virtual pair,
// docs/phase4/VIRTUAL-PAIRS.md) -- or, on HK Frontend, a Music Assistant group
// of the two (a speaker with `pair`). The screens' music feed
// (hk_music/subscribe) lists a pair once: its room's player, its name and
// `parts`, its two players (for Music Assistant's group: the group, whose
// group_members are the two).
//
// So the dashboards draw the player that STANDS for the pair, under the
// pair's name, and leave out the other half (for a group: both halves) -- a
// room's section on Home, its room page, a Home Grid's room block and the
// Speakers & TVs counts (hk-strategy.js byArea/shown/nameOf, hk-room.js
// kindOf). Learned from the feed each build reads (hk-strategy.js generate),
// or from hkMusic's once a card has attached it (pairs()), and kept: the pairs are the
// house's, not a build's, so a call after the build (Edit mode's tiles, a
// room block) folds them too.
//
// Only assigns window.hkPairs at load. A bootstrap file, loaded BEFORE the
// strategy (web/home.js's list; HK Frontend's boot.py CORE): a build that
// ran without it would draw both halves. Until it is here, nothing folds.
// @ts-check
(function () {
  'use strict';
  if (window.hkPairs) return;

  // stand: the player drawn for a pair -> {name, parts}; half: a player the
  // pair stands for -> that player
  /** @type {{stand: Object<string, {name: string, parts: string[]}>, half: Object<string, string>}} */
  var PAIRS = { stand: {}, half: {} }, learned = false;

  function fold(v) { return String(v || '').toLowerCase().replace(/[’‘`]/g, "'"); }
  /** @param {any} client @param {string} id */
  function areaOf(client, id) {
    var e = (client.entities || {})[id] || {}, devs = client.devices || {};
    return e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || null;
  }

  // THE FEED'S SPEAKERS (hkMusic's shape): a speaker with `parts` is a
  // virtual pair, one with `pair` Music Assistant's group of two. A preset
  // (`members`) is its rooms, never a speaker. Not an array: as it was (the
  // feed did not answer); an empty one: no pairs.
  /** @param {any} client @param {any} speakers */
  function learn(client, speakers) {
    if (!Array.isArray(speakers)) return;
    /** @type {typeof PAIRS} */
    var P = { stand: {}, half: {} }, st = (client && client.states) || {};
    speakers.forEach(function (s) {
      if (!s || typeof s.entity !== 'string' || s.members) return;
      var a = st[s.entity] && st[s.entity].attributes;
      var parts = Array.isArray(s.parts) ? s.parts
        : Array.isArray(s.pair) && a && Array.isArray(a.group_members) ? a.group_members : [];
      parts = parts.filter(function (/** @type {any} */ p) { return typeof p === 'string' && p.indexOf('media_player.') === 0; });
      var halves = parts.filter(function (/** @type {string} */ p) { return p !== s.entity; });
      if (!halves.length) return;
      P.stand[s.entity] = { name: s.name ? String(s.name) : '', parts: parts };
      halves.forEach(function (/** @type {string} */ p) { P.half[p] = s.entity; });
    });
    Object.keys(P.stand).forEach(function (s) { delete P.half[s]; });   // a pair's own player is never a half
    PAIRS = P;
    learned = true;
  }
  // the speakers hkMusic already has (a card attached it), else null
  function live() {
    var M = window.hkMusic;
    return M && typeof M.configured === 'function' && M.configured() && typeof M.speakers === 'function'
      ? M.speakers() : null;
  }
  // THE PAIRS: as learned, else (no build has read the feed: a screen with no
  // music pages does not ask) hkMusic's, once a card has attached it
  /** @param {any} client */
  function pairs(client) {
    if (!learned) learn(client, live());
    return PAIRS;
  }

  // The area a pair stands in: its player's own, else (Music Assistant's
  // group has none) its first part's. null for a player that stands for none.
  /** @param {any} client @param {string} id */
  function area(client, id) {
    var p = pairs(client).stand[id];
    return p ? areaOf(client, id) || (p.parts[0] ? areaOf(client, p.parts[0]) : null) : null;
  }
  // What its halves are (a device's model, "HomePod"): a pair is drawn as
  // its speakers are, Music Assistant's group of two HomePods as a HomePod.
  /** @param {any} client @param {string} id */
  function model(client, id) {
    var p = pairs(client).stand[id], ents = client.entities || {}, devs = client.devices || {};
    if (!p) return '';
    return p.parts.map(function (x) {
      var e = ents[x], d = e && e.device_id && devs[e.device_id];
      return d && d.model ? String(d.model) : '';
    }).filter(Boolean)[0] || '';
  }
  // THE PAIR'S NAME, as set in Music settings ("Living Room HomePods"); ''
  // for a player that stands for none. A pair with no name of its own is
  // named by its room there, which on a tile in that room says nothing: it
  // is "<Room> HomePods" (or Speakers).
  /** @param {any} client @param {string} id */
  function name(client, id) {
    var p = pairs(client).stand[id];
    if (!p) return '';
    var a = area(client, id), areas = client.areas || {}, room = a && areas[a] ? String(areas[a].name || '') : '';
    if (p.name && fold(p.name) !== fold(room)) return p.name;
    return room ? room + ' ' + (/homepod/i.test(model(client, id)) ? 'HomePods' : 'Speakers') : p.name;
  }
  // IS THIS PLAYER HALF OF A PAIR DRAWN IN ITS PLACE? Only while the pair's
  // own player is there to stand for it (a state, shown, in an area): a pair
  // whose player is hidden or gone leaves its halves as they were.
  // `hidden(id)`: the build's own exclusions.
  /** @param {any} client @param {string} id @param {(id: string) => boolean} [hidden] */
  function folded(client, id, hidden) {
    var s = pairs(client).half[id];
    if (!s || !(client.states || {})[s] || (hidden && hidden(s))) return false;
    var e = (client.entities || {})[s] || {};
    return !e.hidden && !e.entity_category && !!area(client, s);
  }
  // the player a half's pair is drawn as, or null
  /** @param {string} id @param {any} [client] */
  function half(id, client) { return pairs(client || {}).half[id] || null; }

  window.hkPairs = { learn: learn, live: live, area: area, model: model, name: name, folded: folded, half: half };
})();
