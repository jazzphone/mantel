// Shared card state/update lifecycle. No DOM, transport, or host object lookup.
(function (global) {
  'use strict';
  if (global.hkCardState) return;
  function state(client, id) { return client && client.states && client.states[id]; }
  function signature(client, config) {
    if (!client || !config) return null;
    var ids = [];
    if (config.entity) ids.push(config.entity);
    if (Array.isArray(config.entities)) config.entities.forEach(function (entry) {
      ids.push(typeof entry === 'string' ? entry : (entry && entry.entity));
    });
    if (Array.isArray(config.group)) ids = ids.concat(config.group);
    if (!ids.length) return null;
    var out = '';
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var value = id && state(client, id);
      out += (id || '') + '=' + (value ? value.last_updated : 'x') + ';';
    }
    return out;
  }
  function receive(card, generation, rendered) {
    var sig = card._sigOf();
    if (sig !== null && sig === card._hkSig && card._hkGen === generation) return false;
    card._hkSig = sig;
    card._hkGen = generation;
    card._render();
    rendered(card);
    return true;
  }
  function redraw(card, generation, rendered) {
    card._hkSig = card.client ? card._sigOf() : null;
    card._hkGen = generation;
    card._render();
    rendered(card);
  }
  global.hkCardState = { state: state, signature: signature, receive: receive, redraw: redraw };
  try { global.dispatchEvent(new CustomEvent('hk-card-state-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
