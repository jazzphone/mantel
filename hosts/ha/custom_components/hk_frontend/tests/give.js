// hkGive(card, object): hand a card the host's object WITHOUT drawing it -- what
// tests did by poking the old private field. It sets what the host adapter's
// Lovelace entry (hkHostClient.entry) keeps: the object (read back through the
// card's `hass` getter) and its client (`card.client`). Returns the object.
globalThis.hkGive = function (card, input) {
  card._hkInput = input;
  card._hkEntryClient = globalThis.hkHostClient.from(input);
  card._clientExplicit = false;
  return input;
};
