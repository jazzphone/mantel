// EDIT MODE (modules/hk-edit.js): arranging a page in place, for Owners and
// Admins, never at a wall tablet. Phase A: who may (canEditPage), asked of
// the host (hkShell.atTablet -- Home Assistant: a Wall Tablets entry is this
// page; Mantel: a device session, GET /api/me `at_tablet`), and the API the
// later phases fill (enter / leave / active). A fictional house.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run edit');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');

var TABLET = null;
window.hkSettings = { version: 1, get: function (p, fb) { return fb; }, tablet: function () { return TABLET; } };
load(HK_ROOT + '/frontend/modules/hk-edit.js');

var ok = H.ok, eq = H.eq, E = window.hkEdit;
function who(admin) { return { user: { id: 'u1', name: 'Fictional Person', is_admin: admin } }; }
var client = {};

H.run('EDIT', [
function () {
  H.section('who may edit a page');
  ok('the module is there', !!E && typeof E.canEditPage === 'function');
  eq('nobody signed in: no', E.canEditPage(null, client), false);
  eq('no user: no', E.canEditPage({}, client), false);
  eq('an Adult (not an admin): no', E.canEditPage(who(false), client), false);
  eq('an Owner or Admin on a phone: yes', E.canEditPage(who(true), client), true);
  TABLET = { id: 'kitchen_tablet', room: 'kitchen' };
  eq('Home Assistant: the shell says this page is a Wall Tablets entry', window.hkShell.atTablet(client), true);
  eq('...so an admin at a wall tablet: no', E.canEditPage(who(true), client), false);
  TABLET = null;
  eq('...and away from it again: yes', E.canEditPage(who(true), client), true);
},
function () {
  H.section('the host decides "at a wall tablet"; one that cannot say is taken as one');
  window.hkShell.use({ atTablet: function () { return true; } });
  eq('a host whose device session is a tablet (Mantel at_tablet): no', E.canEditPage(who(true), client), false);
  window.hkShell.use({ atTablet: function () { throw new Error('a broken host'); } });
  eq('a host that throws: no (the servers refuse anyway)', E.canEditPage(who(true), client), false);
  window.hkShell.use({});
  eq('a bare host (no wall tablets at all): yes', E.canEditPage(who(true), client), true);
  window.hkShell.use(window.hkHAShell);
  eq('the Home Assistant shell is back', E.canEditPage(who(true), client), true);
},
function () {
  H.section('the API later phases fill');
  eq('nothing is being edited', E.active(), null);
  eq('enter: not yet (Phase B)', E.enter(null, client), false);
  eq('leave: nothing to leave', E.leave(), false);
  eq('still nothing', E.active(), null);
}
]);
