# Phase 2, P2.4: the HK Settings panel draws with HK's own controls

Completed locally on the slice branch (not merged, not pushed). Production HK has not been edited
or deployed. Roadmap row: [ROADMAP.md](ROADMAP.md) P2.4.

The HK Settings panel (`web/hk/panels/`) used three Home Assistant elements. None is left. The
panel now draws in the Mantel page too: the browser smoke opens it there. The Lovelace card editors
(HA's "Edit card" dialog, `hkEditor` in `web/hk/cards/hk-base.js`) keep `ha-form`. They exist only
inside HA, so they are out of scope.

## Each HA element and what replaced it

| HA element (where) | Replaced by |
|---|---|
| `ha-yaml-editor` (`yamlPage`: a custom page's content, a pop-up's cards, a custom chip, a screen's WallPanel / Kiosk Mode options in YAML) | `hkSettingsKit.yaml(o)`: the kit's YAML editor, a `<textarea>` in a kit cell, with the kit's own YAML reader and writer |
| hidden `ha-form` with an `object` selector, plus `window.loadCardHelpers()` and an entities card's config element (`loadHaForm` / `loadYaml`: only there to make the frontend load `ha-yaml-editor`) | nothing: removed with the editor |
| the JSON `<textarea>` fallback (drawn when HA's editor didn't load within 6 s) | removed. The kit's editor reads JSON too (JSON is YAML flow) |
| `ha-menu-button` (`paintSide` on a narrow window; re-bridged in `_onClient`, `narrow` in the setter) | `hkShell.menuButton(el, { narrow, client })`. HA's shell makes and feeds `<ha-menu-button>`; Mantel's returns `null` (no sidebar of its own) |

`ha-entity-picker`, `ha-selector`, `ha-textfield` and `ha-switch` were never used by the panel. Its
entity pickers were already HK's own (`entityRow` → `pickerPage` → `pickList`, over
`client.states`/`client.entities`, with search and rooms), and so were its switches and text rows.
The panel names one HA element still: `ha-icon`, through `K.icon()` and two glyphs in
`hk-settings.js`. Mantel's shim draws it, so the panel draws there. Its move to `hk-icon` belongs
with P2.2's `ha-icon` → `hk-icon` batches (see "Left").

## Kit additions (`web/hk/panels/hk-settings-kit.js`, version 2.1.0)

- **`yamlParse(text)`** reads what HA's editor read with js-yaml 4 (`DEFAULT_SCHEMA`):
  - block mappings and sequences, including a sequence at its key's indent and `- key: v` / `- - x`
    compact items;
  - flow `[..]` / `{..}` over several lines, so JSON works too;
  - plain, `'single'` and `"double"` scalars over several lines, with all the YAML escapes;
  - `|` / `>` blocks, with chomping and indentation indicators;
  - comments, `---` / `...`, anchors, aliases and `<<` merges (explicit keys win);
  - core-schema null, bool, int (`0x`, `0o`, `0b`, `_`), float (`.inf`, `.nan`), and the core tags
    (`!!str`, `!!int`, …).

  It refuses what js-yaml refused, with the line number: a duplicated key, a tab indent, an unknown
  tag (`!secret`, `!include`), bad indentation, an unclosed quote or flow, an unknown alias, a
  second document. Cross-checked during the slice against PyYAML on a 34-document corpus (HK's own
  examples, block scalars, flow, anchors, folding). Only documents where YAML 1.1 and 1.2 agree
  were used.
- **`yamlDump(value)`** writes the editor's starting text, as close to js-yaml's `dump` as matters:
  - block style, two spaces, keys in order;
  - `{}` / `[]` inline;
  - a string in `"double quotes"` only where it would read back as something else (numbers,
    bools, `null`, YAML 1.1's `on`/`yes`/`n`, indicators, `: `, ` #`, …);
  - a multi-line string as a `|` / `|-` / `|+` block.

  A 20,000-value fuzz (strange strings as keys and values, nesting) read back unchanged during the
  slice. The committed suite pins a set of those cases.
- **`yaml(o)`**, the editor control. It does what HA's editor did on these pages:
  - the value is written out to begin with (nothing for an empty one);
  - it is read back on every change, and `o.onChange(value, valid)` gets it: empty text is `{}`,
    a mistake is `(undefined, false)`;
  - the mistake is shown under the text in red, by line (`aria-invalid`, `aria-describedby`, a
    polite live region);
  - Tab indents two spaces (Escape, then Tab, leaves the field), and Return keeps the line's indent
    (two more after `key:`).

  Its CSS (`.codebox`) is in `K.CSS`, in the kit's look: a cell, 13 px monospace, the tint focus
  ring, and a red ring on a mistake.

## Host shell addition

`hkShell.menuButton(el, opts)`: the host's own sidebar button for a page of HK's own shown as one of
the host's pages.
- Contract (`web/client/hk-host-shell.js`): defaults to `null`.
- HA (`hosts/ha/frontend/hk-ha-shell.js`): needs `<ha-menu-button>` to be defined. It makes the
  button once, then hands it the frontend's object for `opts.client` (through `hkHAClient.bridge`)
  and `opts.narrow`, each only when given.
- Mantel (`web/shim/mantel-shell.js`): `null`.

The panel calls it exactly where it used to touch HA's button: `paintSide` (narrow: make it,
bridge, set narrow), `_onClient` (bridge only) and `set narrow` (narrow only).

## What is saved, unchanged, and how tests pin it

Each YAML page's save goes through `client.actions` with the same message, path and body as before.
`yamlPage` still saves `cur && typeof cur === 'object' ? cur : {}`, and still refuses an invalid text
("The YAML has a mistake.").

| Page | Saved (unchanged) |
|---|---|
| Custom page content | `POST /api/config/config_entries/subentries/flow` `{handler: [entry, 'page'], subentry_id}`, then `…/flow/<id>` `{title, view, icon}` |
| Pop-up cards | the pop-up flow, then `{name, close_after, dashboards, cards, icon, width}` (one card alone becomes a list of it) |
| Custom chip | `hk_frontend/chip/save` `{name, after, card, key}`. A valid change is the page's draft (`_chipForms[key].card`); a mistake isn't |
| WallPanel / Kiosk Mode options (YAML) | `board/set` through `setB`, as before (same `yamlPage` path) |

New suite **`test_settingsforms.js` (76 assertions)**:
- **The kit's reader.** Every construct above, with expected values; the refusals and their line
  numbers.
- **The writer.** Exact text for a card and a list of cards, the quoting rules, `|` blocks; round
  trips of strange strings as keys and values.
- **The editor.** Its starting text, `(value, valid)` per change, empty → `{}`, the mistake shown
  and cleared, and its accessibility attributes.
- **The panel.**
  - A YAML page draws the kit's editor. No HA form element is drawn or asked of
    `customElements.get`, and the panel source names none and doesn't call `loadCardHelpers`.
  - It pins each page's saved messages as above (with HA's adapter over a recorder): emptied →
    `view: {}`; a scalar → `{}`; a mistake sends nothing; the chip's draft survives a redraw.
  - On Mantel the save is refused at the port, nothing reaches the host, and the page shows its
    error.
  - The sidebar button goes through `hkShell.menuButton`. A host with a button gets it first in
    the sidebar's head; Mantel gets just the title.

**Before and after.** The suite's 15 "what each YAML page saves" assertions were also run against
the panel as it was at `HEAD`. They ran with a stand-in `ha-yaml-editor` that fires HA's
`value-changed` with the parsed value. All 15 passed there too, so the messages are the same. That
scratch copy is not committed: it needs the old panel.

**Other tests:**
- `test_hostshell.js` (44 → 49): `menuButton` in HA. Nothing until HA defines its button; then HA's
  element, handed the frontend's object and `narrow`; the same button again with only what is
  given. With no host: `null`.
- `test_settingspanel.js`: unchanged and still green. Its "HA's own menu button is handed the
  frontend's object" assertion now passes through the shell.
- **`tests/test_shell_boundary.py`, tightened.**
  - `ha-menu-button` joins `SHELL_NAMES`: no shared file may name it. The HA shell must.
  - New `test_the_settings_panel_names_no_ha_form_element`: `web/hk/panels/*.js` code (comments
    stripped) names none of `ha-form`, `ha-yaml-editor`, `ha-code-editor`, `ha-entity-picker`,
    `ha-selector`, `ha-textfield`, `ha-switch`, `ha-select`, `ha-combo-box`, `ha-icon-picker` or
    `ha-menu-button`, and doesn't call `loadCardHelpers`.
  - There was no allowance for these names to remove: the boundary test never listed form
    elements.
- `tests/fixtures/css_snapshot.json`: `hkSettingsKit.CSS` updated (the `.codebox` rules), on purpose.
- **Browser smoke (`tools/headless/client_smoke.py`), new `settings_forms` line:**
  - `<hk-settings-panel>` is created in the Mantel page and handed Mantel's snapshot through the
    adapter's entry, as `panel_custom` does. `OfflineReads` answers `hk_frontend/panel/get` with a
    fictional, minimal payload (one custom page).
  - It opens on Mantel's client, with its sidebar and no menu button (narrow, Mantel has none) and
    no HA form element.
  - Added Accessories' picker lists `Offline lamp` and `Offline temperature`, and a search for
    "lamp" leaves one.
  - The custom page's YAML editor shows its view as YAML, says
    `a flow collection is not closed (line 1)` for a mistake, and clears it once mended.
  - Save is refused at the action port (`POST /api/config/config_entries/subentries/flow`). No
    write frame is sent and 0 writes are blocked. The only frame is the page's own re-read
    (`hk_frontend/panel/get`), which it makes after every save, as in HA.

## Validation

| Check | Result |
|---|---|
| HA frontend suites | **121, all green** (120 + `test_settingsforms`) |
| HA Python | 665 passed, 1 skipped (unchanged) |
| Mantel | **166 passed** (164 + 2 boundary tests) |
| Browser smoke | passed: new `settings_forms` line; 0 external requests, 0 exceptions, 0 blocked writes |

## Visible differences in the HA build

Only on the YAML pages:
- **The editor.** It is a plain monospace text field in a kit cell, not HA's CodeMirror editor. It
  has no syntax colouring, no line-number gutter, and no CodeMirror search or bracket matching.
- **Mistakes.** A mistake is said in red under the text, with its line, and the cell gets a red
  ring. Save still refuses it with "The YAML has a mistake."
- **Loading.** The editor appears at once. Before, it waited for HA to load `ha-form` and its YAML
  editor, and after 6 s fell back to a JSON text field.
- **Starting text.** It is the kit's writer's. It matches js-yaml's `dump` for card configs except
  for long strings: js-yaml folded them at 80 columns, and the kit keeps them on one line.
- **Dates.** A date or timestamp in the YAML is kept as the ISO string it was always sent as (e.g.
  `2026-10-18` → `"2026-10-18T00:00:00.000Z"`). js-yaml made a `Date`, which JSON turned into that
  same string, so the saved data is identical.
- **What isn't read.** These now get an error by line, where HA's editor accepted them:
  - complex keys (`? `);
  - an anchor or tag before a mapping on its own line (`- &a key: v`);
  - js-yaml's `!!binary`, `!!omap`, `!!pairs`, `!!set` and `!!timestamp` tags.

  None of these is in HK's documentation or examples.

The sidebar button is HA's `ha-menu-button` as before; it is only made in HA's shell now. Mantel
has never had that button.

## Left

- **`ha-icon` in the panel** (`K.icon`, the preview-size glyphs, and `.seg.pvsize ha-icon` in
  CSS). It moves to `hk-icon` with P2.2's batches or as a small follow-up. That one needs
  `hk-elements.js` loaded where the panel runs in HA (today it is registered at bootstrap, so it
  should already be there), and a look in the test HA.
- **The smoke's `panel/get`** is answered by `OfflineReads`, not by Mantel's real `ReadProxy`, which
  refuses it (not on its allowlist). Serving HK Settings for real in Mantel needs a settings source
  on the Mantel side. That is a later Mantel step, not this slice.
- **`docs/phase2/ROADMAP.md`'s P2.4 row** is not marked here (parallel slices edit that table); the
  orchestrator marks it on merge.

## Exact continuation point

P2.4 is complete on its branch (`worktree-agent-a9664363472de9f82`), not merged. Next:
1. The orchestrator merges this slice, marks ROADMAP P2.4 ✅ with a link here, and checks the YAML
   pages once in the scratch test HA (`tools/testha/`): a custom page's content, a pop-up's cards, a
   custom chip. Expect the editor described under "Visible differences in the HA build".
2. The panel's `ha-icon` → `hk-icon` goes with P2.2 (see "Left").
