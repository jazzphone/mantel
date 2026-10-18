// Service dispatch: a failed call must not be silent, and must not take the
// user's input with it.
//
// WHAT THIS PINS. A callService written as a statement, its promise dropped,
// turns a rejection into nothing at all -- no log, no UI change, a tap that
// looks like it worked. A card that wipes what you typed or selected on the
// line after the call, before the call resolves, loses your input with it.
//
// The failure path is the entire point, so it is what these tests drive.
var root = HK_ROOT;
var pass = 0, fail = 0;
function check(name, cond) { print((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; }

load(root + '/tests/dom.js');
['hk-base', 'hk-tile', 'hk-media', 'hk-cameras', 'hk-security', 'hk-home']
  .forEach(function (n) { load(root + '/frontend/cards/' + n + '.js'); });

// Capture console.error so "it was logged" is an assertion, not a hope.
var logged = [];
globalThis.console = { error: function () { logged.push([].slice.call(arguments).join(' ')); },
                       warn: function () {}, info: function () {}, log: function () {} };

// The quick-timer helpers' scripts: the keypad checks they exist before it
// calls one (no helpers installed is its own message, not a network failure).
var HELPERS = { 'script.quick_timer_create': { state: 'off', attributes: {} },
                'script.quick_timer_start': { state: 'off', attributes: {} } };

function hassThat(mode) {          // 'ok' | 'reject' | 'throw'
  var sent = [];
  return {
    sent: sent,
    states: HELPERS,
    callService: function (d, s, data) {
      sent.push(d + '.' + s);
      if (mode === 'throw') throw new Error('sync boom');
      return mode === 'reject' ? Promise.reject(new Error('rejected'))
                               : Promise.resolve({});
    }
  };
}
function card(tag, cfg) {
  var c = Object.create(customElements.get(tag).prototype);
  c._config = cfg; c._root = new (Object.getPrototypeOf(document.createElement('div')).constructor)('div');
  c._root.querySelector = function () { return null; };
  return c;
}
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 6); i++) p = p.then(function () {}); return p; }

// --- no card may shadow HkBase._call ---------------------------------------
// A card with its own _call (the alarm keypad's _call(service), the timers
// card's _call(entity, service, data)) that is routed through
// this._call(domain, service, data) calls ITSELF, overflows the stack, and
// Disarm / Home / Away / pause / cancel send nothing at all.
var HkBaseProto = Object.getPrototypeOf(customElements.get('hk-tile-card').prototype);
while (HkBaseProto && !Object.prototype.hasOwnProperty.call(HkBaseProto, '_call')) {
  HkBaseProto = Object.getPrototypeOf(HkBaseProto);
}

// The same trap applies to every helper the base class offers, not just
// _call. The action-feedback contract has five more names that a card could
// plausibly reach for on its own (_begin and _end especially), and a card
// that defines one gets the base class's callers
// silently talking to its version. So the guard enumerates instead of naming
// one method: add a helper to HkBase and it is protected from that moment.
//
// disconnectedCallback is EXEMPT and listed as such -- overriding it is the
// normal way for a card to clean up, and several do. The rule for those is
// the ordinary one: call super.disconnectedCallback().
var PROTECTED = ['_call', '_callResp', '_begin', '_end',
                 '_setStatus', '_paintStatus', '_statusNode'];
var shadows = [];
Object.keys(_defined).forEach(function (tag) {
  var p = _defined[tag].prototype;
  while (p && p !== HkBaseProto) {
    PROTECTED.forEach(function (m) {
      if (Object.prototype.hasOwnProperty.call(p, m)) shadows.push(tag + '.' + m);
    });
    p = Object.getPrototypeOf(p);
  }
});
check('no card shadows an HkBase helper (' + (shadows.join(', ') || 'none') + ')',
      HkBaseProto && shadows.length === 0);

// Every protected name must actually EXIST on the base class, or the guard
// above silently protects nothing -- a rename would pass it unchanged.
var missing = PROTECTED.filter(function (m) {
  return !HkBaseProto || typeof HkBaseProto[m] !== 'function';
});
check('every protected name exists on HkBase (' + (missing.join(', ') || 'none') + ')',
      missing.length === 0);

// --- an overriding disconnectedCallback MUST chain -------------------------
// HkBase.disconnectedCallback does real work -- it clears the
// status timer and releases the card's hk-stats subscriptions. A card that
// overrides it without calling super silently keeps both, and the only symptom
// is a subscriber set that grows until the high-water backstop trips.
//
// Read from the SOURCE rather than by calling it: invoking a teardown on a
// card that was never attached is not a safe assertion to make, and this is
// the property that actually matters -- the call is written down.
var unchained = [];
['cards/hk-base', 'cards/hk-tile', 'cards/hk-media', 'cards/hk-cameras',
 'cards/hk-security', 'cards/hk-home', 'cards/hk-popup', 'cards/hk-row',
 'cards/hk-weather', 'cards/hk-layout', 'cards/hk-chip', 'cards/hk-stat',
 'cards/hk-control', 'cards/hk-energy'].forEach(function (f) {
  var src;
  try { src = readFile(root + '/frontend/' + f + '.js'); } catch (e) { return; }
  // Every override except HkBase's own definition.
  var re = /disconnectedCallback\s*\(\s*\)\s*\{([\s\S]{0,400}?)\n\s{0,6}\}/g, m;
  while ((m = re.exec(src))) {
    var body = m[1];
    if (body.indexOf('_hkStatusT') !== -1) continue;        // HkBase's own
    if (body.indexOf('super.disconnectedCallback') === -1) {
      unchained.push(f + ':' + src.slice(0, m.index).split('\n').length);
    }
  }
});
check('every disconnectedCallback override chains to super ('
      + (unchained.join(', ') || 'none') + ')', unchained.length === 0);

// --- ...and so must connectedCallback, on an HkBase card --------------------
// HkBase.connectedCallback redraws a card that was released from hk-stats
// while still waiting. An override that does not chain leaves a chart (Energy,
// say) stuck on "Loading". hk-row-card extends HTMLElement, not
// HkBase, so it has no super to call and is exempt.
var unchainedC = [];
['cards/hk-cameras', 'cards/hk-popup', 'cards/hk-weather', 'cards/hk-energy',
 'cards/hk-stat', 'cards/hk-media', 'cards/hk-home', 'cards/hk-security',
 'cards/hk-tile', 'cards/hk-chip', 'cards/hk-control', 'cards/hk-layout'].forEach(function (f) {
  var src;
  try { src = readFile(root + '/frontend/' + f + '.js'); } catch (e) { return; }
  var re = /[^A-Za-z]connectedCallback\s*\(\s*\)\s*\{([\s\S]{0,300}?)\n/g, m;
  while ((m = re.exec(src))) {
    var body = src.slice(m.index, m.index + 300);
    if (body.indexOf('super.connectedCallback') === -1) {
      unchainedC.push(f + ':' + src.slice(0, m.index).split('\n').length);
    }
  }
});
check('every HkBase connectedCallback override chains to super ('
      + (unchainedC.join(', ') || 'none') + ')', unchainedC.length === 0);

(function () {
  var kp = card('hk-alarm-keypad-card', { entity: 'alarm_control_panel.x' });
  if (!customElements.get('hk-alarm-keypad-card')) { check('alarm keypad card is registered', false); return; }
  var h = hassThat('ok'), got = null;
  h.callService = function (d, s, data) { h.sent.push(d + '.' + s); got = data; return Promise.resolve({}); };
  hkGive(kp, h); kp._code = '1234';
  var err = null;
  try { kp._alarm('alarm_disarm'); } catch (e) { err = e; }
  check('keypad Disarm does not throw', err === null);
  check('keypad Disarm sends exactly alarm_control_panel.alarm_disarm',
        h.sent.length === 1 && h.sent[0] === 'alarm_control_panel.alarm_disarm');
  check('keypad Disarm carries the typed code', got && got.code === '1234'
        && got.entity_id === 'alarm_control_panel.x');
  check('keypad clears the code after sending', kp._code === '');

  var tm = card('hk-timers-card', {});
  var th = hassThat('ok'); hkGive(tm, th); err = null;
  try { tm._timer('timer.quick_1', 'pause'); } catch (e) { err = e; }
  check('timers pause does not throw', err === null);
  check('timers pause sends timer.pause', th.sent.length === 1 && th.sent[0] === 'timer.pause');
})();

// --- the shared helper ---------------------------------------------------
var base = card('hk-tile-card', { entity: 'light.x' });
hkGive(base, hassThat('reject'));
logged.length = 0;
var boolOnFail = null, boolOnOk = null;
base._call('light', 'turn_on', { entity_id: 'light.x' }).then(function (v) { boolOnFail = v; });
tick().then(function () {
  check('a failed call resolves false rather than rejecting', boolOnFail === false);
  check('a rejected call is logged, not swallowed',
        logged.length === 1 && logged[0].indexOf('light.turn_on failed') !== -1);

  // A callService that throws SYNCHRONOUSLY must not take the tap handler
  // down with it.
  var threw = false;
  hkGive(base, hassThat('throw'));
  logged.length = 0;
  try { base._call('a', 'b', {}); } catch (e) { threw = true; }
  return tick().then(function () {
    check('a synchronous throw becomes a rejection, not an exception', !threw);
    check('the synchronous throw is logged too', logged.length === 1);
    hkGive(base, hassThat('ok'));
    return base._call('x', 'y', {}).then(function (v) { boolOnOk = v; }).then(function () {
    check('an accepted call resolves true', boolOnOk === true);

    // --- the timer keypad ------------------------------------------------
    var kp = card('hk-timer-new-card', {});
    kp._digits = '130'; kp._name = 'Pasta';
    kp._paint = function () {};
    kp._parse = function () { return { total: 5400 }; };

    hkGive(kp, hassThat('reject'));
    kp._start();
    return tick().then(function () {
      check('a failed timer keeps the digits', kp._digits === '130');
      check('a failed timer keeps the name', kp._name === 'Pasta');
      check('a failed timer releases the busy latch', kp._busy === false);

      // Same card, working backend: NOW it clears.
      hkGive(kp, hassThat('ok'));
      kp._start();
      return tick().then(function () {
        check('a successful timer clears the digits', kp._digits === '');
        check('a successful timer clears the name', kp._name === '');

        // Double-tap during the round trip sends once.
        var slow = { states: HELPERS, sent: [], _res: null,
          callService: function (d, s) { this.sent.push(d + '.' + s);
            var self = this; return new Promise(function (r) { self._res = r; }); } };
        var kp2 = card('hk-timer-new-card', {});
        kp2._digits = '15'; kp2._name = ''; kp2._paint = function () {};
        kp2._parse = function () { return { total: 900 }; };
        hkGive(kp2, slow);
        kp2._start(); kp2._start(); kp2._start();
        check('three taps during one flight send one call', slow.sent.length === 1);
        slow._res({});
        return tick().then(function () {
          check('the form clears once the slow call lands', kp2._digits === '');

          // --- the vacuum area picker --------------------------------------
          var vac = card('hk-area-select-card', { floors: [], start_script: 'script.clean' });
          vac._sel = new Set(['kitchen', 'office', 'loft']);
          vac._render = function () {};
          hkGive(vac, hassThat('reject'));
          vac._start();
          return tick().then(function () {
            check('a failed clean keeps all three areas selected', vac._sel.size === 3);
            check('a failed clean releases the busy latch', vac._busy === false);

            hkGive(vac, hassThat('ok'));
            vac._start();
            return tick().then(function () {
              check('a successful clean clears the selection', vac._sel.size === 0);

              // --- no script: the Clean Areas feature sends the vacuums itself
              // (it is added: the settings feed's `added` says so)
              var prevHS = window.hkSettings;
              window.hkSettings = { get: function (p, f) { return p === 'added' ? ['clean_areas'] : (prevHS ? prevHS.get(p, f) : f); } };
              var vac2 = card('hk-area-select-card', { floors: [] });
              vac2._sel = new Set(['kitchen', 'loft']);
              vac2._render = function () {};
              var asked = null;
              hkGive(vac2, { states: {}, services: { hk_frontend: { clean_areas: {} } }, callService: function (d, s, data, t, n, want) {
                asked = [d + '.' + s, data, want];
                return Promise.resolve({ response: { ok: true, plan: [], unreachable: [] } });
              } });
              vac2._start();
              return tick().then(function () {
                check('no script: Clean Areas (hk_frontend.clean_areas), asking for the answer',
                      asked && asked[0] === 'hk_frontend.clean_areas' && asked[2] === true &&
                      asked[1].areas.join() === 'kitchen,loft');
                check('...and the answered ok clears the selection', vac2._sel.size === 0);
                var vac3 = card('hk-area-select-card', { floors: [] });
                vac3._sel = new Set(['attic']);
                vac3._render = function () {};
                hkGive(vac3, { states: {}, services: { hk_frontend: { clean_areas: {} } }, callService: function () {
                  return Promise.resolve({ response: { ok: false, message: 'No vacuum can reach the selected areas.' } });
                } });
                vac3._start();
                return tick().then(function () {
                  check('an area no vacuum reaches keeps the selection and says so',
                        vac3._sel.size === 1 && JSON.stringify(vac3._hkStatus || '').indexOf('No vacuum') >= 0,
                        vac3._hkStatus);
                  // --- stub configs name no script --------------------------
                  var Stub = customElements.get('hk-area-select-card');
                  var stub = Stub.getStubConfig({ states: { 'script.unlock_everything': { state: 'off', attributes: {} } } });
                  check('the picker stub names NO script (not the first one it finds)',
                        stub && !('start_script' in stub), stub);
                  var tstub = customElements.get('hk-timer-new-card').getStubConfig(
                    { states: { 'script.unlock_everything': { state: 'off', attributes: {} } } });
                  check('the timer keypad stub names no script either', tstub && !('create_script' in tstub), tstub);
                  // Some vacuums started, one did not: keep only its areas.
                  var vac4 = card('hk-area-select-card', { floors: [] });
                  vac4._sel = new Set(['kitchen', 'loft', 'office']);
                  vac4._render = function () {};
                  hkGive(vac4, { states: {}, services: { hk_frontend: { clean_areas: {} } }, callService: function () {
                    return Promise.resolve({ response: { ok: false,
                      plan: [{ vacuum: 'vacuum.down', action: 'clean_area', areas: ['kitchen'] },
                             { vacuum: 'vacuum.up', action: 'clean_area', areas: ['loft'] },
                             { vacuum: 'vacuum.office', action: 'start', areas: ['office'] }],
                      failed: [{ vacuum: 'vacuum.up', error: 'busy' }],
                      message: 'Some vacuums did not start: vacuum.up' } });
                  } });
                  vac4._start();
                  return tick().then(function () {
                    check('a partly failed clean keeps only the failed vacuum\'s areas',
                          vac4._sel.size === 1 && vac4._sel.has('loft'), Array.from(vac4._sel));
                    check('...and says which', statusOf(vac4).kind === 'failed' &&
                          /vacuum\.up/.test(statusOf(vac4).text), vac4._hkStatus);
                    // Home Assistant's own refusal is shown, not "could not reach".
                    var vac5 = card('hk-area-select-card', { floors: [] });
                    vac5._sel = new Set(['kitchen']);
                    vac5._render = function () {};
                    hkGive(vac5, { states: {}, services: { hk_frontend: { clean_areas: {} } }, callService: function () {
                      return Promise.reject({ code: 'service_validation_error', message: 'HK Frontend is not loaded.' });
                    } });
                    vac5._start();
                    return tick().then(function () {
                      check('a refusal by Home Assistant is shown as its own words',
                            /not loaded/.test(statusOf(vac5).text), vac5._hkStatus);
                      // Areas no vacuum reaches, the rest sent: a warning that stays.
                      var vac6 = card('hk-area-select-card', { floors: [] });
                      vac6._sel = new Set(['kitchen', 'attic']);
                      vac6._render = function () {};
                      hkGive(vac6, { states: {}, services: { hk_frontend: { clean_areas: {} } }, callService: function () {
                        return Promise.resolve({ response: { ok: true, unreachable: ['attic'],
                          plan: [{ vacuum: 'vacuum.down', action: 'clean_area', areas: ['kitchen'] }] } });
                      } });
                      vac6._start();
                      return tick().then(function () {
                        check('partly unreachable is a lasting warning, not a failure',
                              statusOf(vac6).kind === 'warn' && !vac6._hkStatusT, vac6._hkStatus);
                        // Clean Areas not added: said so, nothing called.
                        window.hkSettings = prevHS;
                        var vac7 = card('hk-area-select-card', { floors: [] });
                        vac7._sel = new Set(['kitchen']);
                        vac7._render = function () {};
                        var called7 = false;
                        hkGive(vac7, { states: {}, services: {}, callService: function () {
                          called7 = true; return Promise.resolve({}); } });
                        vac7._start();
                        check('without Clean Areas: says to add it, calls nothing',
                              !called7 && /Add Clean Areas/.test(statusOf(vac7).text) &&
                              vac7._sel.size === 1 && vac7._busy === false, vac7._hkStatus);
                        return outcomes();
                      });
                    });
                  });
                });
              });
            });
            });
          });
        });
      });
    });
  });
});

// ===========================================================================
// THE ACTION-FEEDBACK CONTRACT
//
// The busy latch and the retained input are covered above. On top of them,
// the person pressing the key is TOLD something, and above all "Home
// Assistant accepted the call" and "a timer actually started" are reported
// as different things.
//
// There are four timer slots, and starting a fifth is ordinary. script.turn_on
// resolves when the script BEGINS, so it cannot tell a started timer from a
// form cleared for nothing. These pin the three answers the allocator gives.
function statusOf(c) { return c._hkStatus || { kind: null, text: '' }; }

// A hass whose callService returns a SERVICE RESPONSE, the way a blocking
// script call does. `resp` is what ends up in _callResp's .response.
function hassReturning(resp) {
  var sent = [];
  return {
    sent: sent, states: HELPERS,
    callService: function (d, s, data, target, notify, returnResponse) {
      sent.push({ call: d + '.' + s, data: data, wantsResponse: returnResponse });
      return Promise.resolve({ response: resp });
    }
  };
}

function keypad(hass) {
  var kp = card('hk-timer-new-card', {});
  kp._digits = '15'; kp._name = 'Pasta';
  kp._paint = function () {}; kp._render = function () {};
  kp._parse = function () { return { total: 900 }; };
  hkGive(kp, hass);
  return kp;
}

function outcomes() {
  // --- the call shape itself -----------------------------------------------
  // A response can only come back from a BLOCKING call. script.turn_on returns
  // the moment the script starts and carries nothing, so the keypad must call
  // the script as its own action and must ask for the response.
  var k0 = keypad(hassReturning({ started: true, slot: 'timer.quick_1' }));
  k0._start();
  return tick().then(function () {
    check('the keypad calls the script directly, not script.turn_on',
          k0.hass.sent[0].call === 'script.quick_timer_create');
    check('the keypad asks for the service response',
          k0.hass.sent[0].wantsResponse === true);
    check('the keypad sends the digits and the name',
          k0.hass.sent[0].data.digits === '15' && k0.hass.sent[0].data.name === 'Pasta');
    check('a started timer clears the form', k0._digits === '' && k0._name === '');
    check('a started timer reports success', statusOf(k0).kind === 'sent');

    // --- all four slots busy -------------------------------------------------
    // THE CASE THE RESPONSE EXISTS FOR. Accepted, and nothing started.
    var k1 = keypad(hassReturning({ started: false, reason: 'no_free_slot' }));
    k1._start();
    return tick().then(function () {
      check('a full timer rack is NOT reported as success',
            statusOf(k1).kind === 'warn');
      check('a full timer rack says which four', /four/i.test(statusOf(k1).text));
      check('a full timer rack KEEPS the typed duration', k1._digits === '15');
      check('a full timer rack keeps the typed name', k1._name === 'Pasta');

      // --- nothing typed ------------------------------------------------------
      // A different sentence from no_free_slot: one is "the house is full",
      // the other is "you did not type a duration".
      var k2 = keypad(hassReturning({ started: false, reason: 'zero_duration' }));
      k2._start();
      return tick().then(function () {
        check('a zero duration warns', statusOf(k2).kind === 'warn');
        check('a zero duration does not blame the timer slots',
              !/four/i.test(statusOf(k2).text));

        // --- dispatch rejected ---------------------------------------------
        var k3 = keypad(hassThat('reject'));
        k3._start();
        return tick().then(function () {
          check('a rejected dispatch reports failure, not warning',
                statusOf(k3).kind === 'failed');
          check('a rejected dispatch keeps the digits', k3._digits === '15');

          // --- an HA that returns no response at all --------------------------
          // A timer script that returns nothing. "Accepted" is all that is
          // known, so it is all that is claimed -- and the form clears as it
          // would for any accepted call rather than being held hostage.
          var k4 = keypad(hassReturning(null));
          k4._start();
          return tick().then(function () {
            check('no response means sent, not started', statusOf(k4).kind === 'sent');
            check('no response still clears the form', k4._digits === '');

            // --- failures must not expire ---------------------------------
            // A 'sent' message is informative and times out. A 'warn' or a
            // 'failed' describes something still to act on and must sit there
            // until the next attempt.
            var k5 = keypad(hassReturning({ started: false, reason: 'no_free_slot' }));
            k5._start();
            return tick().then(function () {
              check('a warning schedules no expiry', !k5._hkStatusT);
              var k6 = keypad(hassReturning({ started: true, slot: 'timer.quick_2' }));
              k6._start();
              return tick().then(function () {
                check('a success does expire on its own', !!k6._hkStatusT);
                clearTimeout(k6._hkStatusT);

                // --- the pending state is visible ------------------------------
                // _begin must repaint, or the button still says "Start" and is
                // the thing that gets pressed twice.
                var painted = 0;
                var slow = { states: HELPERS, sent: [], _res: null,
                  callService: function () { var s = this;
                    return new Promise(function (r) { s._res = r; }); } };
                var k7 = keypad(slow);
                k7._render = function () { painted++; };
                k7._start();
                check('_begin repaints so the button can show it is inert', painted === 1);
                check('the pending state is announced', statusOf(k7).kind === 'pending');
                check('the card is latched while pending', k7._busy === true);
                slow._res({ response: { started: true, slot: 'timer.quick_3' } });
                return tick().then(function () {
                  check('the latch releases when the slow call lands', k7._busy === false);

                  // --- the status timer must not outlive the card -------------
                  var k8 = keypad(hassReturning({ started: true, slot: 'timer.quick_4' }));
                  k8._start();
                  return tick().then(function () {
                    check('a success armed a timer', !!k8._hkStatusT);
                    k8.disconnectedCallback();
                    check('disconnecting clears the pending status timer',
                          !k8._hkStatusT);

                    // --- no helpers installed ---------------------------------
                    // A card placed by hand where the quick-timer helpers were
                    // never added: it says so, and calls nothing.
                    var bare = hassReturning({ started: true });
                    bare.states = {};
                    var k9 = keypad(bare);
                    k9._start();
                    check('no timer helpers: nothing is called', bare.sent.length === 0);
                    check('no timer helpers: says so, as a failure',
                          statusOf(k9).kind === 'failed' && /helpers/.test(statusOf(k9).text));
                    check('no timer helpers: not "could not reach Home Assistant"',
                          !/reach/i.test(statusOf(k9).text));
                    check('no timer helpers: the typed duration is kept', k9._digits === '15');

                    print(fail ? 'FAIL ' + fail + ' DISPATCH TESTS'
                               : 'ALL ' + pass + ' DISPATCH TESTS PASS');
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}
