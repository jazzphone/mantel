// The shared base's client lifecycle: gating, forced wakes and reconfiguration.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run clientstate');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
var Base = window.hkCards.HkBase;
class Reading extends Base {
  _render() { this.draws = (this.draws || 0) + 1; this.value = this._st((this._config || {}).entity); }
}
function client(state, updated, other) {
  return window.hkClient.create({ states: {
    'sensor.demo': { state: state, last_updated: updated },
    'sensor.other': { state: other, last_updated: other }
  }, themes: { darkMode: true } });
}
H.run('CLIENT STATE', [function () {
  var notifications = 0, off = hkCards.onClient(function () { notifications++; });
  var sample = hkCards.previewClient({ states: {'sensor.demo': {state:'sample'}}, actions: {callService:function () {throw new Error('not a preview');}} });
  var card = new Reading(); card.setConfig({entity:'sensor.demo'}); card.client = sample;
  H.eq('sample data renders without publishing to the live client feed', card.value.state, 'sample');
  H.eq('sample clients never notify live subscribers', notifications, 0); off();
}, function () {
  var card = new Reading();
  card.setConfig({ entity: 'sensor.demo' });
  card.client = client('1', 'a', '1');
  H.eq('client supplies base state lookup', card.value.state, '1');
  H.ok('raw host never assigned', card.hass == null);
  var count = card.draws;
  card.client = client('1', 'a', '2');
  H.eq('unrelated entity does not redraw', card.draws, count);
  card.client = client('2', 'b', '2');
  H.eq('relevant entity redraws once', card.draws, count + 1);
  H.eq('new state reaches the base', card.value.state, '2');
  card.requestUpdate();
  count = card.draws;
  card.client = client('2', 'b', '2');
  H.eq('forced redraw remembers its signature', card.draws, count);
  card.setConfig({ entity: 'sensor.other' });
  H.eq('reconfig reads the new entity', card.value.state, '2');
  count = card.draws;
  card.client = client('2', 'b', '3');
  H.eq('reconfigured dependency updates', card.draws, count + 1);
  card.client = window.hkClient.create({ states: {} });
  H.eq('deleted state is removed from the readout', card.value, undefined);
  H.ok('absent state is in the signature', card._sigOf().indexOf('sensor.other=x;') >= 0);
}, function () {
  var card = new Reading();
  card.setConfig({ entity: 'sensor.demo', entities: ['sensor.other', { entity: 'sensor.third' }], group: ['light.demo'] });
  card.client = client('1', 'a', '1');
  var sig = card._sigOf();
  H.ok('array and object entity declarations are covered', sig.indexOf('sensor.other=1;') >= 0 && sig.indexOf('sensor.third=x;') >= 0);
  H.ok('group members are covered', sig.indexOf('light.demo=x;') >= 0);
  card.setConfig({});
  var count = card.draws;
  card.client = client('1', 'a', '1');
  card.client = client('1', 'a', '1');
  H.eq('unknown dependencies keep the safe always-render behavior', card.draws, count + 2);
}, function () {
  var card = new Reading();
  card.setConfig({ entity: 'sensor.demo' });
  card.client = client('1', 'a', '1');
  card.isConnected = true;
  card.connectedCallback();
  var count = card.draws;
  window.dispatchEvent(new CustomEvent('hk-module-ready'));
  H.eq('module ready wakes a hostless connected card', card.draws, count + 1);
  count = card.draws;
  card.client = client('1', 'a', '1');
  H.eq('following unchanged snapshot is gated', card.draws, count);
  card.isConnected = false;
  card.disconnectedCallback();
  window.dispatchEvent(new CustomEvent('hk-module-ready'));
  H.eq('detached card does not render on module wake', card.draws, count);
  card.isConnected = true;
  card.connectedCallback();
  card.client = client('1', 'a', '1');
  H.eq('reattached card catches up with module generation', card.draws, count + 1);
}, function () {
  var definitions = window.hkCards, lifecycle = window.hkCardState, host = window.hkHostClient;
  delete window.hkCards;
  delete window.hkCardState;
  delete window.hkHostClient;
  load(HK_ROOT + '/frontend/cards/hk-base.js');
  H.ok('base waits for its lifecycle and host port', !window.hkCards);
  window.hkCardState = lifecycle;
  window.dispatchEvent(new CustomEvent('hk-card-state-ready'));
  H.ok('base still waits for the host port', !window.hkCards);
  window.hkHostClient = host;
  window.dispatchEvent(new CustomEvent('hk-host-client-ready'));
  H.ok('base publishes when dependencies arrive', !!window.hkCards.HkBase);
  window.hkCards = definitions;
}]);
