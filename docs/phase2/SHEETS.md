# Phase 2 P2.5: HK's own sheets and dialogs

Done 2026-10-18 on its branch (the planning session merges it). Production HK has not been edited
or deployed. PLAN.md §10: "HA's more-info dialog as a fallback for an entity type HK has no sheet
for — replaced by HK's generic sheet plus an 'Open in Home Assistant' link for Admins."

## What HK draws itself now

- **The generic sheet** (`hk-detail-generic`, `web/hk/cards/hk-detail.js`). For an entity HK has
  no sheet of its own for (`hkDetail.kindOf` is null: a scene, the sun, an update, an event, a
  tilt-only blind, …) on a host without a detail dialog of its own. It is drawn in the same sheet
  frame as every other sheet (header with the tile's name and glyph, the admin gear, Close, Back,
  history entry, Escape), and shows:
  - the glyph, and the state through `client.formatEntityState` (a long state, such as a date and
    time, steps down from 52 to 30 px and wraps);
  - "Since …" (last changed);
  - up to 8 key attributes, named by `client.formatEntityAttributeName` and formatted by
    `client.formatEntityAttributeValue`. Left out: what the sheet already shows (name, glyph,
    unit, device and state class), the host's bookkeeping (`supported_features`, `editable`,
    `id`, `restored`, `assumed_state`, `attribution`, …), members (`entity_id`), `options`,
    and anything that is not a short value (objects, empty or long strings, long lists);
  - one control, and only where it is obvious, always through the client's action port
    (`HkBase._call`, so Mantel refuses it): **Activate** (`scene.turn_on`) for a scene, **Run**
    (`script.turn_on`) for a script, **Turn On/Off** (`homeassistant.toggle`) for an on/off
    state in `remote`, `group`, `input_boolean`, `switch`, `light`, `fan`, `humidifier`. Nothing
    for what hk-base never toggles in one tap (`neverToggles`: locks, alarms, valves, sirens, door
    covers, …) and nothing for anything else. A tile's `confirmation` is asked first, as the
    toggle sheet does;
  - **"Open in Home Assistant"**, only for an admin (`client.user.is_admin`) on a host that has
    its own detail (`hkShell.hostDetail(id)`). Pressed, the sheet closes with its history entry
    first, then the host shows its own detail (`hkShell.openHostDetail`). The order matters: HA's
    dialog keeps a history entry of its own, and the sheet's Back landing after it would close it.
    In Mantel the link is never shown.
- **The toast layer** (`web/hk/shell/hk-overlays.js`, `window.hkOverlays`). HK keeps asking for
  toasts through `hkShell.toast` (the host's toast event, bubbling and composed). On a host that
  does not draw that event itself (`hkShell.hostToast()` false: Mantel) the layer draws it once
  it reaches the window. A page that shows a library's messages in its own place (the Music page,
  the screensaver's music panel) still hears it on the way up and stops it, so it never gets
  there. One toast at a time, as HA's (a new one replaces the one showing); `{ message, duration
  (ms; 3000 by default; 0 or less stays), action: { text, action }, dismissable }`; a polite live
  region in the shell's dialog root, above the sheets (z-index 10001), drawn in `OVER.solid`.
  Mantel's own "Commands are disabled in Mantel (read-only)" refusal now goes through it too
  (`web/shim/mantel-host.js`; its old `#mantel-toast` box is only a fallback before the layer
  loads).
- **Confirmations.** HK's confirm and choose sheets were already its own (`hkCards.confirmSheet`,
  `hkCards.chooseSheet` in hk-base.js, since before Phase 1: HA's `show-dialog` cannot be used by
  a custom card). They now mount in the shell's dialog root (`hkShell.dialogRoot()`), and move
  there again if the root changed since they were made: the document's body in HA (where they
  always were), `#hk-shell-root` in Mantel.

## When HK takes a more-info request

The capture listener in hk-detail.js decides with `hkShell.hostDetail(id)`:

| Request | Host with its own detail (HA) | Host without (Mantel) |
|---|---|---|
| a kind HK has a sheet for, from a dashboard or an hk card | HK's sheet | HK's sheet |
| a kind with no sheet here (or its sheet's element not defined yet) | **HA's more-info**, the event untouched (as before) | HK's generic sheet |
| detail sheets switched off (`look.details`, a card's `detail: false`, `hk-detail-off`) | HA's more-info (as before) | HK's generic sheet (there is no host dialog to fall back on) |
| from outside a dashboard (HA's Settings, a dialog, HA's root) | HA's more-info (as before) | HK's sheet, else the generic sheet: nobody else would answer |
| an entity with no state | HA's more-info (as before) | not taken (nothing to show) |

`hkDetail.open(id, src, { generic: true })` opens the generic sheet when there is no sheet of
its own; `{ generic: 'only' }` opens it whatever the kind.

## What the HA build still hands to HA, and why

- **The more-info dialog** for every kind HK has no sheet of its own for, for sheets switched off,
  and for requests from HA's own pages. HA's dialog has history, logbook, settings, related items
  and the attribute list for every domain; HK's generic sheet is deliberately smaller. Replacing it
  in HA would take those away from every user who has them today (PLAN.md §10 gives the generic
  sheet's link to admins only), so the HA build keeps HA's dialog behind the shell's capability:
  `hostDetail` is true in HA's shell. Switching HA to the generic sheet later is one line in
  `hosts/ha/frontend/hk-ha-shell.js` (`HA.hostDetail` returning false for the kinds to move) plus
  its tests; the admin link then opens HA's dialog (pinned: test_sheets.js, and checked in the
  scratch HA below).
- **Toasts** stay HA's snackbar (`hass-notification`): `hostToast` is true in HA's shell, and
  HK's toast layer is not even loaded in the HA build (`boot.py` does not list it; the file is
  shipped under `frontend/shell/` with the rest of `web/hk`, unused).
- **HK's confirm sheets** stay on the document's body (`HA.dialogRoot`), not HA's shadow root
  where HA's own dialogs live, so nothing about their stacking or inherited styles changes.

**No visible change in the HA build.** The listener's decisions in HA are the same as before
(test_sheets.js drives them; test_detail.js pins the source), toasts are the same event from the
same element, and the confirm sheets mount on the same node.

## Host capabilities added (`web/client/hk-host-shell.js`)

| Member | Default (no host; Mantel) | HA (`hosts/ha/frontend/hk-ha-shell.js`) |
|---|---|---|
| `hostDetail(entityId)` | `false` | `true` (more-info shows any entity) |
| `openHostDetail(entityId, from?)` | `false` | `hass-more-info` `{ entityId }` from `<home-assistant>`, bubbling, composed; `true` (`false` without an entity). HK's listener never takes it: it is not from a dashboard. |
| `hostToast()` | `false` (HK's toast layer draws) | `true` (HA's snackbar) |
| `dialogRoot()` | `overlayRoot()`, else `document.body` | `document.body` |

A throwing `hostDetail` / `openHostDetail` / `hostToast` answers `false`; a throwing `dialogRoot`
answers `null`. Mantel's shell (`web/shim/mantel-shell.js`) states the three `false`s explicitly
and takes the default dialog root (`#hk-shell-root`). HA's panel mode (P2.6) inherits HA's answers.

## Tests

- **`test_sheets.js`** (new, 27, HA's shell from the prelude): a scene, the sun, a tilt-only blind,
  an entity without state, sheets switched off, a request from HA's Settings or root: not taken,
  no sheet (HA's dialog opens); a light: HK's sheet. The generic sheet only when asked for; its
  admin link closes the sheet with its history entry, then fires `hass-more-info` from
  `<home-assistant>` (and HK's listener lets that through); no link for a non-admin. A toast is
  HA's event and HK's layer stays out; the confirm and choose sheets mount on the body.
  A mutation check (passing `generic` in HA) fails three of them.
- **`test_sheets_mantel.js`** (new, 43, a Mantel-like shell installed before the modules load):
  every request is HK's (generic sheet for a scene, mounted in the shell's root; a light keeps
  its own sheet; a request from outside a dashboard; sheets switched off; no state: not taken);
  the generic sheet's state, since, rows through the client's formatters and what is left out,
  the long-state size, Activate / Run / Turn Off through the action port, none for a siren or the
  sun, the tile's confirmation first, Unavailable; the link hidden in Mantel and shown on a host
  with a detail of its own for an admin only. Toasts: drawn in HK's layer in the shell's root,
  gone after 3 s, an action button, one at a time, `duration: -1` with Dismiss, a handled
  (`defaultPrevented`) or empty one not drawn, nothing on a host that draws its own. The confirm
  and choose sheets in the shell's root.
- `sheet_harness.js` (new, not a suite): the DOM, history and request plumbing both share.
- `test_hostshell.js` (+9): HA's four answers; the defaults; an overlay root as the dialog root; a
  throwing capability says no.
- `test_detail.js` (+1): the listener's source now carries the host check.
- `test_overlays.js`: `shell/hk-overlays` joins the scanned files (its plate is `OVER.solid`).
- `test_csssnapshot`: the fixture gains `hk-detail-generic.CSS` (nothing else changed).
- `tests/test_shell_boundary.py` (+4): shared code asks for no HA dialog or notification
  (`show-dialog`, `ha-more-info-dialog`, `ha-toast`, `notification-manager`, `dialog-box`,
  `ha-snackbar`; the one lookup is hk-detail's list of HA dialogs a tap may come from); the toast
  layer names no host element; HA, Mantel and the contract declare the capabilities; Mantel loads
  the layer after its shell and HA's boot does not.
- **`tools/headless/client_smoke.py`**: in Mantel, `hkShell.moreInfo` for the fictional scene from
  its tile opens HK's generic sheet (`hk-more-info`, kind `generic`, `hk-detail-generic` in
  `#hk-shell-root`, state "unknown", Activate, no link for the owner, no `ha-*`/`hui-*` element in
  it, no host dialog in the page); Activate is refused (`scene.turn_on`) and said in HK's toast
  layer; a toast and a confirm sheet mount in `#hk-shell-root`; no `#mantel-toast`; 0 frames sent.

## Checked in the scratch HA (demo devices, 127.0.0.1:8124; started and stopped by this slice)

Built from this branch: tapping `light.kitchen_lights`' name opened HK's light sheet;
`hkShell.moreInfo('event.backup_automatic_backup', <an hk tile>)` (no HK sheet) opened HA's
`ha-more-info-dialog` and no HK sheet; `hkShell.toast` showed in HA's snackbar with no HK layer
(`hkOverlays` not loaded); the confirm sheet mounted on the body; the generic sheet asked for
directly showed "Unknown", "Event types: completed, failed, in_progress" (HA's formatters) and the
admin link, and the link closed it and left HA's more-info dialog open. No exceptions.

Mantel screenshots (offline smoke data, not committed): the generic sheet for the sun (state,
since, four attribute rows), for a scene (glyph, state, Activate) and a toast with an action.

## Validation

- Frontend: 126 suites green (124 + `test_sheets`, `test_sheets_mantel`).
- HA Python: 679 passed, 1 skipped (unchanged).
- Mantel: 217 passed (213 + 4 boundary tests).
- Browser smoke: green with the new `sheets` step; 0 external requests, 0 browser exceptions,
  commands disabled.

## Left

- **HA still uses its own dialog** for kinds HK has no sheet for (see above). Moving HA to the
  generic sheet is a decision for Avery (one capability line); until then the admin link is seen
  only on hosts with a detail of their own that choose HK's generic sheet.
- **Mantel's formatters** are minimal (`mantel-host.js`): a state is its raw value plus unit
  ("above_horizon"), an attribute name its key with spaces and a capital, a value as is or a list
  joined. HA's localized formatting comes with a real Mantel client.
- **The sun's glyph** is missing in Mantel's stand-in `hk-state-icon` (its MDI subset); HA draws it.
- The toast layer follows the dark look only (`OVER.solid` and white text) on every theme, as HA's
  snackbar does; a Flat Light variant can follow if wanted.
- `docs/PLAN.md` is not edited here (for the planning session).

## Exact continuation point

P2.5 is complete on its branch. Merge it, re-run the four validations and the smoke. Then, if
Avery wants HA to match PLAN.md §10 fully, switch `HA.hostDetail` to false for the kinds HK should
answer with its generic sheet (the admin link then opens HA's dialog), update `test_sheets.js`'s
HA expectations, and check it in the scratch HA before the house.
