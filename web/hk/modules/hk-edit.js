// hk-edit.js - EDIT MODE: arranging a page in place, as the Home app does
// (drag the pills, make one Tall, Done). Owners and Admins only, and never at
// a wall tablet, whoever is signed in there. The servers stay the real check
// (Mantel's `configure`, Home Assistant's require_admin); this only decides
// whether the page offers it.
//
// Phase A (the groundwork) gives:
//   canEditPage(h, client)  true when the person may edit this page here: an
//                           Owner or Admin (h.user.is_admin, h being the
//                           host's object or HKClient) and not at a wall
//                           tablet. "At a wall tablet" is the host's to say:
//                           hkShell.atTablet(client) -- Home Assistant: a Wall
//                           Tablets entry is this page (hk-settings.js
//                           tablet()); Mantel: a device session, with or
//                           without a person on top (GET /api/me at_tablet).
//                           A host that cannot say is taken as a tablet.
//   enter / leave / active  the edit session, filled by the later phases
//                           (B: the bar, the wiggle, Cancel and Done).
//
// Loaded by hk-loader.js in both hosts; it does nothing at load time but
// assign window.hkEdit.
(function (global) {
  'use strict';
  if (global.hkEdit) return;

  function canEditPage(h, client) {
    if (!(h && h.user && h.user.is_admin)) return false;
    var SH = global.hkShell, at = false;
    try { at = SH && typeof SH.atTablet === 'function' ? SH.atTablet(client) : false; } catch (e) { at = null; }
    return at === false;
  }

  // THE EDIT SESSION (Phase B onwards): which page is being edited, or null
  var session = null;
  function active() { return session; }
  function enter() { return false; }
  function leave() {
    if (!session) return false;
    session = null;
    return true;
  }

  global.hkEdit = { canEditPage: canEditPage, enter: enter, leave: leave, active: active };
})(typeof window !== 'undefined' ? window : globalThis);
