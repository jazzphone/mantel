# Handoff: HomeGrid custom detail sheets and Security cards

Date: 2026-11-07. Status: implementation plan; no production implementation or house configuration change is included in this handoff.

## 1. Outcome and agreed scope

Implement one reusable **Custom Detail Sheet** option on **every HomeGrid block**, and extend the existing Security block with the five HomeView presentations explored in this conversation. Security is an application of the shared sheet, not a separate popup framework.

The user should be able to:

1. Edit any HomeGrid block and choose **When Tapped -> Custom Detail Sheet**.
2. Give the sheet a title, select several entities, and arrange them.
3. Choose **Same as Screen / Home / Tall (HomeView)** for its accessory tiles.
4. Set basic appearance overrides independently for each entity.
5. Add entities in bulk, duplicate an entry, and copy a populated sheet from another block.
6. Open an entity's existing controls from the overview, then return to the same overview and scroll position.
7. Use the new Security presentation at Small 1 x 1, Wide 2 x 1, Compact 3 x 1, Large 2 x 2, and Extra Large 3 x 2.

Everything is opt-in. Existing block appearances, tap behavior, alarm keypads, configured screens, and user defaults must remain as saved until deliberately changed. Do not replace the house's separate Security-row tiles as part of implementation or testing.

### Design decisions from the review

- Follow Mantel's actual accessory tiles and native detail sheets. Do not invent a second visual language for Security.
- An unlocked lock or open garage uses the normal **white active-entity surface**, dark name text, secondary state text, and the appropriate colored state glyph. The alarm uses its existing state/color semantics.
- The user explicitly rejected amber row washes, amber edge stripes, alert-like accent bars, and decorative emphasis. Do not restore those treatments.
- Tall/HomeView means a large **bare** glyph above the centered name and one secondary line. No circular well behind the main accessory glyph; no tiny icon with extra small-print summaries.
- A full entity tile/row is the tap target. Opening the overview or an entity's sheet does not itself operate the device.
- The last reviewed overview is an arrangement of the alarm and five entry accessories as consistent accessory tiles. It opens over the dashboard, not as a second card stacked beneath a dashboard tile.
- The older preview called 2 x 2 "Tall." Correct name: **Large**. The actual existing size class `T` remains 1 x 2. **Tall (HomeView) styling is independent of block size.**

## 2. Sources and design references

Canonical implementation workspace: `/Volumes/data/mantel`. Read the current owning files before editing; this handoff records inspection at commit `6ceca02f` (`Near-square Centred tiles take the square cell's glyph`). Only an unrelated Xcode project-file modification was present at inspection. Re-check status and preserve unrelated work.

Required design and architecture sources:

- `/Volumes/config/hk_house/docs/DESIGN.md`: the user's requested design specification. Its old frontend paths map to Mantel's canonical `web/hk` sources.
- `docs/phase11/HOMEVIEW-LOOK.md`: HomeView geometry, widget behavior, options-only compatibility, shared frontend/backend catalogs.
- `docs/phase11/HOME-GRID.md`: grid sizes, views, editor and persistence.
- `docs/development/Rules.md`: host boundaries, commands-off testing, private-data and glyph rules.
- `docs/development/Building-and-Testing.md`: supported local checks; skips are not passes.
- `docs/development/Handoff-2026-11-07-group-block-spacing.md`: recent spacing and optical-glyph fixes that must not regress.

Private conversation references are included in the separate handoff bundle under `references/`. Keep that bundle private; these concept files are not repository/build assets:

| Reference | Use |
|---|---|
| `references/security-refined.html` | Latest reviewed direction: in-context overview, device navigation, Tall/HomeView and Home styles, white active states. |
| `references/security-card-sizes.html` | Five proposed Security size compositions and overflow. Use as a composition reference, not final production styling. |

Earlier `security-card.html`, `security-card-states.html`, and `security-detail.html` are superseded. The mockups contain sample state, placeholder icon choices, standalone CSS and simulated controls; **do not transplant their rendering, PIN handling, timers, state mutation, palette, or control logic into production**. Use the existing native implementations. No browser/device acceptance of these mockups is recorded.

Do not publish private reference files or the original house screenshot. Repository fixtures and screenshot evidence must use an invented home and redistributable fallback glyphs. Apple's fonts/glyphs remain supplied privately by each home, as Rules.md requires.

### Two specification discrepancies to handle explicitly

1. DESIGN.md still mentions the older 66/50 px glyphs. Current `hkCards.TILE.centred` uses **76 px square / 58 px tall glyphs**, in 82/64 px boxes. `centredTile()` also selects square geometry for near-square cells, scales larger cells, and uses optical ink normalization. Reuse those current helpers; do not reintroduce the old measurements.
2. DESIGN.md contains both a clean-scroll-edge rule and older sheet-shadow/fade wording. Current `hk-base.js` `shadeCss()` returns an empty string and the detail shell specifies clean edges. Reuse the current shell/edge helpers, with **no new fade or scrolling-edge shadow**; clarify the stale documentation when implementing. Do not add a competing local policy.

## 3. Shared custom-sheet configuration and editing

### Card editor flow

Add the option in the common block editor, not only to cards whose catalog currently declares `opts.tap`:

**Edit Block -> When Tapped -> Custom Detail Sheet -> Configure Sheet**

Keep existing Automatic/Page/Detail Sheet/Nothing and card-specific choices, such as Music's playlist behavior. Restoring the default restores the saved normal behavior; it must not discard a previously configured custom sheet unless the user chooses Remove Sheet.

The sheet editor contains:

| Setting | Behavior |
|---|---|
| Title | Optional plain text; falls back to the block's friendly title. Use the existing title length/escaping rules. |
| Header icon | Automatic or the existing icon picker. No remote image URL or arbitrary markup field. |
| Tile style | Same as Screen, Home, Tall (HomeView). Map to the existing `home`/`centred` render styles; do not invent a third tile renderer. |
| Entities | Ordered entries, each with an entity picker, current name/state preview, edit appearance, duplicate and remove. |
| Add Entities | Search/multi-select using the existing entity picker. Add several in one operation, in a deterministic order. |
| Copy from Another Block | Copy a configured custom sheet from another permitted block. Present its title and source screen/block; create an independent copy. |
| Preview | Uses the real sheet renderer over sample/read-only data; switches Home/Tall and current appearance without house service calls. |
| Reset Appearance | Remove local overrides for this sheet or entry; restore inheritance. |

Keep these controls in the iOS-style Settings/editor system. The configuration UI does not wear Bright Glass or HomeView tile styling.

### Per-entity appearance: required first version

All overrides are **local to this popup entry**. They must not rename/recolor the entity on other dashboards or rewrite global accessory settings.

| Setting | Default and constraints |
|---|---|
| Entity | Required visible entity ID selected through the normal picker. Native domain behavior remains authoritative. |
| Display name | Automatic or local plain-text alias. Automatic follows Mantel's configured accessory name and current native naming rules. |
| Icon | Automatic native/state-aware glyph, or the existing validated icon picker. Preserve native open/closed or locked/unlocked glyph pairs; reuse the accessory editor's supported state-icon configuration rather than hand-writing a second one. |
| Color | Automatic native/domain color, an existing named accent, or a validated custom color. It changes the accent/glyph, not the white active surface or the underlying state. Use existing Flat color/contrast resolution. |
| Tile style | Same as Sheet, Home, Tall (HomeView). An entry override wins over the sheet's setting. |
| Line Under Name | Automatic, State, Room, Brightness, Attribute, Hidden. Reuse `secondary` where possible; add a validated shared Room mode if the existing model cannot express it. Attribute selection is a bounded attribute name plus optional unit, not a template. |

Automatic display resolution: entry override -> explicit sheet style -> screen style -> existing system default. For name/icon/color, local omission means the entity's existing configured appearance. Reset removes an override; do not serialize a resolved inherited value as if it were local.

Do not add free CSS, arbitrary background/opacity/radius sliders, executable conditions, custom service-call definitions, or a generic "force active" switch. Visual overrides must not falsify Locked/Unlocked, Open/Closed, Armed/Disarmed, unavailable, or permission states. A sensor uses a reading/state tile and its native read-only sheet; it does not gain a toggle because it appears in a popup.

Mixed Home/Tall entries must use a deliberate row/span layout: full-height Tall entries reserve complete rows/spans and neighboring short tiles align predictably. Do not stretch every short tile to the tallest peer or create random gaps. Reuse the existing Full/Half grouped-accessory layout where it already solves this; cover mixed-style layout in the visual checks.

### Duplication and population

- **Duplicate Entry:** insert immediately after the source; generate a fresh entry ID; deep-copy appearance/secondary settings. Keep the entity selected initially so the user can replace it with another entity. Do not share a mutable configuration object.
- Allow repeated entity IDs in this new popup-entry model, with different entry IDs and appearance/readout choices. This makes Duplicate Entry usable, including two readouts for one entity. Do not relax the existing Accessories block's deduplication rules accidentally.
- **Duplicate Block:** where the editor already supports it, include its custom sheet and regenerate nested entry IDs. If block duplication is missing, add the action using the editor's existing placement/make-room functions; do not overlap saved blocks or silently rearrange an occupied grid.
- **Copy Sheet from Another Block:** deep-copy the sheet title/style/ordered entries; no live linkage. Editing the copy must not affect its source.
- Support entry reordering by touch and a keyboard-accessible alternative. Preserve stable entry IDs, selection and focus during reorder.
- Warn clearly at the supported entry limit; do not silently truncate. Start from the existing bounded list policy (`LIST_MAX`, currently 24), and validate the same limit on both sides. Measure larger lists before increasing it. This is not a hard-coded four-device sheet.
- Zero entries is a valid editor draft. Saving an enabled empty sheet should produce a clear editor validation message. A sheet that becomes empty because of permissions/deletions must show a dismissible empty state at runtime.

## 4. Persistence, routing and permissions

### Proposed common schema

Use a shared block-level field so the option applies to the entire catalog. The following is a design proposal to implement, **not accepted current JSON**. Names may be adjusted once in the implementation, consistently in JS/Python/editor/docs.

```json
{
  "id": "example_security",
  "card": "security",
  "size": "S",
  "at": [0, 0],
  "opts": {"presentation": "homeview"},
  "interaction": {
    "tap": "custom_sheet",
    "custom_sheet": {
      "v": 1,
      "title": "Security",
      "tile_style": "centred",
      "entries": [
        {"id": "entry_1", "entity": "alarm_control_panel.example"},
        {
          "id": "entry_2",
          "entity": "lock.example_front",
          "name": "Front Door",
          "secondary": {"mode": "state"}
        }
      ]
    }
  }
}
```

Fictional IDs above are not the house's entity IDs. Resolve the real IDs only during a separately authorized setup; never guess them from display names.

- Absent `interaction` preserves today's behavior. `interaction.tap: default` can retain a populated but inactive custom-sheet draft and delegate to the block's existing behavior. Custom Sheet explicitly overrides the block's normal open/detail activation.
- Keep this configuration block-level in the first version: the same custom sheet applies while rules/fallbacks/pager pages change the block's contents. State that scope in the editor. Carry it through `variantOf`, updates, resize, move, save, import/export, screen copy and duplication without losing it. Do not introduce inconsistent per-rule overrides as an accidental side effect.
- Keep old `opts.tap` values intact as the normal behavior to return to. Define precedence once in the common routing layer; do not independently interpret it in every card.
- Validate schema versions, enum values, text lengths, icon/color fields, entry IDs, entity syntax, attributes, bounds and duplicate entry IDs on the server and in editor feedback. Avoid arbitrary Python-only or JS-only acceptance.
- Nested popup entities must participate in `entity_ids()` and `only_viewable()` just like ordinary block entities. Include them in current save authorization, subscriptions, imports/copies and any MCP/settings schema or summaries that expose HomeGrid configuration.
- Filter inaccessible entity references and local appearance data before sending a person's visible configuration. Do not leak hidden IDs, local names, counts, states or sheet summaries. Copy/duplicate does not expand access.
- Entity removal/unavailability must not discard an entire otherwise valid saved grid. Use the existing tolerant read/strict write split; an unknown device is not implicitly secured. Keep live allowed-but-unavailable entries labeled Unavailable; remove forbidden entries through existing permission filtering.

### Tap behavior for the entire catalog

Audit every key returned by the catalog rather than testing only cards that already declare `tap_target`.

- A simple accessory/scene/action block can use Custom Sheet as its explicitly chosen primary activation. It must not also toggle a device or run a scene underneath.
- On a compound widget, its background/title/detail activation opens the custom sheet. Embedded transport buttons, sliders, timer rings, thermostat arrows, camera/player controls and individual device actions retain their own behavior.
- If a card has no safe non-control activation surface, expose an appropriate visible, accessible 44 px detail affordance; do not require a tap in an invisible gap or hijack a slider/video gesture.
- Pager swipe, page swipe, scrolling, long press, drag and live Edit mode must not accidentally open the sheet. Custom-tap handling must respect existing event consumption and gesture classification.
- Repeated taps open one sheet; navigating to an entity replaces/pushes through the existing detail stack. Back restores the custom overview, title, overrides, order, scroll offset and focus. Closing returns focus to the originating block.
- No custom service-call bypass: use `HKClient`, `hkShell`, existing detail panels and both host adapters. The feature's configuration and permissions remain owned by `hk_core`.

## 5. Detail sheet: every supported format and appearance

Treat each of the following as acceptance requirements, not a screenshot of one green Bright Glass surface.

### Appearance matrix

| Appearance | Required treatment |
|---|---|
| Glass (`clear`) | Existing transparent material, tokenized ink/rim/shadow and native sheet overlay. Do not replace it with a fixed green panel. |
| Frosted | Existing milky material and its strength/color resolution; no new backdrop blur added to inner tiles. |
| Tinted | Existing dark plate and sheet policy. The page avoids blur; the native sheet may retain its own blur while open. Do not impose Flat's no-blur rule on Tinted. |
| Blur: Shared Layer | Use the existing sheet compositor. Inner cards are `glass: false` and never enroll in the page's shared blur layer. |
| Blur: Pre-rendered | The page keeps its pre-rendered behavior; the open sheet follows the existing live sheet/overlay policy. Test scroll and background changes for rectangular artifacts. |
| Blur: Each Card | Keep the native sheet's blur; inner accessories still do not create a second independent blur. |
| Bright Glass: Shared Layer / Pre-rendered / Each Card | Support all three modes, Strength and inherited settings. Use the Bright Glass sheet tokens and heavy sheet blur, not the lighter 4 px plate blur. Maintain contrast over the brightest wallpaper stops. |
| Flat Light | Opaque elevated white sheet; theme-correct ink; native tinted/off tile palette; recessed stone keys/controls; active entity tiles remain white with readable dark text and their bright glyph colors. No blur, glass rim or glass-only shadow. |
| Flat Dark | Opaque elevated dark sheet with native graphite/tint hierarchy; active tiles remain white. Use the existing dark accent rules rather than lightening/darkening them locally. No blur. |

Also exercise Glass/Blur/Frosted/Tinted/Bright against light host pages where supported. Resolve screen/page/room accent, Flat Accent and Off Pill Tint, custom colors, icon-color preference and Same as All Screens through existing settings. The sheet is mounted outside the page: explicitly preserve the opener's effective appearance context so inheritance does not silently fall back to an unrelated default.

Use `hkCards.v()`, `plate()`, `flatSurface()`/the existing detail shell and supported `--hk-sheet-*` overrides. Do not copy literal colors/shadows from the mockup. A genuinely new token needs a name, a LIGHT/Flat policy where applicable, design documentation and relevant guards. Reuse `ink-on-room` and `ink-on-state` on white active surfaces (`#464649`/`#767678` current fallbacks); state text must not remain pale glass ink on white.

### Accessory layout formats

| Format | Contract |
|---|---|
| Home | Render native Home accessory tiles/pills with their existing layout and domain-specific content. Preserve measured 196 x 70 regular / 76 favorite / 150 tall geometry as applicable, standard wells and label rules. Do not approximate these with generic HTML buttons. |
| Tall (HomeView), square/near-square | Use `centredTile()`, `TILE.centred.square`, `hkInkScale` and the actual icon component: currently 82 px box / 76 px glyph, glyph center 33%, name at 57.7%, 21/600 name, 20/400 secondary, 27 px lines. Bare icon in resting and active states. Current near-square/container-query and optical scaling behavior must be inherited. |
| Tall (HomeView), shorter rectangular cell | Use current `TILE.centred.tall`: 64 px box / 58 px glyph, glyph center 31%, text at 55%, 17/16 px name/secondary, 22 px lines. Do not force the square layout into a 150 px cell or globally shrink text to make more entries fit. |
| Same as Screen | Resolves the screen's effective tile style, including Automatic's cell-shape rule. A local sheet or entry choice is independent of the HomeGrid block's footprint. |
| Mixed per-entry formats | A local entry style can differ from the sheet. Use deterministic row/spans; reserve enough height for Tall entries and preserve short-entry geometry. Validate long names and mixed rows rather than relying on one homogeneous example. |

The main HomeGrid card and the sheet's child tiles have different containment rules: square-cell blocks keep the 34 px block radius and 18 px inset, inside a block uses 16 px; a sheet uses its own `SP` and native accessory radii. Do not apply the grid-block 34/16 rule indiscriminately to the whole dialog and every child. Do not let the page grid's CSS scale make the modal itself tiny.

### Sheet frame, screens and scrolling

- Reuse the `hk-detail.js` shell and width kinds. At inspection, tablet constants are `STD=460`, `WIDE=820`, `SHEET_H=680`, header padding 24, header well/X 44, sheet radius 38; phone radius is 30 and phone breakpoint is `BP.phone=640`. Consume the owning values/helpers rather than duplicating these numbers.
- Use the existing wider-sheet option when native Tall tiles need more columns and the available viewport can hold it. Prefer measured content/capacity to the mockup's hard-coded 660 px width. A small phone must not inherit a desktop three-column layout.
- Respect phone/tablet portrait, landscape, wide desktop, Square display, docked menu and Side Pane, safe-area insets, browser zoom and the short-screen/car path. Center in the actual content region that opened the sheet, as the current shell does.
- Preserve the existing short-screen media rule (landscape, height <= 500 and width > phone breakpoint), including side-by-side alarm controls. Do not force a tall keypad or a 680 px inner body into that viewport.
- Keep the header, Back and Close reachable. Body content can scroll within the native bounded frame; the underlying HomeGrid stays fixed. Account for the existing body top inset and the actual clipped frame in Safari zoom.
- **The full sheet does not truncate at "N more."** All allowed configured entities remain reachable by scrolling. "N more" belongs to constrained HomeGrid cards, not to the full popup.
- Capacity responds to entity count, tile format, long names, text scaling and actual content width. Preserve useful tile sizes and at least 44 x 44 px effective on-screen touch targets. Do not claim that 44 logical pixels in a scaled grid automatically achieves that.
- The current shell's clean scroll edges remain clean: no new gradient/fade/shadow at either scrolling end. Preserve stable column alignment and no 8 px pill bleed in sheet grids (`--hk-cell-bleed:0px`).
- Recompute on resize/orientation/style changes without losing scroll/focus or re-subscribing every entry. Cases of 1, 2, 6, 12 and the supported maximum entries must fit predictably; odd counts do not stretch a last entity into an oversized action.

### Interaction, states and accessibility

- Reuse current native glyphs and fallbacks, not Lucide/CSS-filled substitutes from the mockups. A lock must use its true locked/unlocked pair, and the garage its closed/open pair. Main HomeView glyphs must have the optical weight of peer accessories.
- Use the existing one-second hold control for unlocking/opening and tap behavior for securing. Early release, cancel, scroll, close, lost pointer capture or navigation cancels the hold. A completed hold fires once and must not reverse on release.
- The alarm opens the existing keypad/PIN flow, honoring its configured modes, PIN rules, person/device permissions and command-disabled/read-only behavior. Never copy the mockup's "any four digits" simulation.
- Pending, arming, disarming, locking, unlocking, opening, closing, jammed, failed, unknown and unavailable are distinct from confirmed states. Display the native state; do not label a transition Locked/Closed or count an unavailable device as secured.
- Keyboard operation, meaningful accessible names/state, focus-visible, Escape, backdrop dismissal and focus trapping through shadow roots follow the existing shell. Focus the sheet when opened, not an input that raises the tablet keyboard. Restore focus on Back and Close.
- State changes update content in place. They must not reorder tiles, rebuild the entire sheet, restart entry animations or disturb a user's hold/scroll.
- Use `EASE`/`DUR` for bounded sheet and press motion. Respect Reduce Motion, Flat's motion policy, visibility/asleep state and cleanup on detach. No new perpetual attention pulse or decorative animation.
- Preserve native controls when present: dimmer/shade/fan sizing, continuous thermostat bands, read-only sensor content, chart precision and video-close contrast. This feature composes existing panels; it does not redesign those panel types.

## 6. Existing Security block: five new HomeView presentations

Extend the existing `security` catalog entry. Add an explicit opt-in presentation, proposed `opts.presentation: homeview`; omission retains today's legacy Security layout, including existing L/XL keypad presentations. Do not replace them on existing screens.

| User label | Span | Required composition |
|---|---|---|
| Small | 1 x 1 (`S`) | Large native Security glyph, centered name, one secondary state line in Tall/HomeView. Whole tile opens Security overview. Keep Home styling available as well. |
| Wide | 2 x 1 (`W`) | Alarm status with compact lock/garage summaries. Summary groups open the Security overview or relevant native entity sheet; no tiny inline keypad. |
| Compact | 3 x 1 (new, proposed `C`) | Alarm area at left, individual entry slots at right. White active entries and final "N more" slot when needed. |
| Large | 2 x 2 (`L`) | Alarm header/controls affordance above full-width entry rows; overflow determined from actual available height. This is the preview previously mislabeled Tall. |
| Extra Large | 3 x 2 (`XL`) | Alarm area at left with two columns of entries. The review's four locks plus garage should all be directly visible on a normal HomeView square-cell layout. Smaller/shorter cells may need overflow rather than shrunken controls. |

`C` is a new footprint, not an alias for `W` or `T`. Add it consistently to `SIZES`, `HOME_GRID.sizes`, JS/Python catalog parity, editor size labels, sizing/capacity/placement/rules, resize UI and test fixtures. Offer it to Security's HomeView presentation; choosing it sets the presentation explicitly. Validate the combination server-side. Never reinterpret stored `T=1x2`, `W=2x1`, `L=2x2`, `XL=3x2`, `XXL=6x2` or `F`.

### Security membership and semantics

The review example contains an alarm panel, Front Door lock, Back Door lock, Garage Entry lock, Garage Door cover, and Crawl Space lock. That is **six accessories total: one alarm, four locks and one garage cover**. Use fictional equivalent devices in repository tests; real entity IDs are not known from this conversation.

- Offer Automatic (current configured, viewable Security devices) and Choose Entities. Explicit order is stable; do not reorder entries whenever one unlocks. Keep the existing Security source rules, rather than blindly collecting every entity with a matching domain.
- Reuse the same appearance-entry model and shared overview renderer. The native Security summary can supply an automatic entity resolver; an explicitly configured custom sheet remains a deliberate selected list. Do not create two independently editable copies of the same Security membership by default.
- Counts include the full configured/viewable Security set, including entities behind "N more." If Crawl Space is hidden by capacity and unlocked, the block still indicates an unsecured entry. Do not include inaccessible entity counts.
- White active treatment applies per unsafe entry. Locked/closed entries use the normal resting surface. An armed alarm uses its existing active treatment; a disarmed alarm does not claim the whole house is secured.
- Small has exactly one secondary line: prioritize Triggered; then the number of unsecured entries; then missing/unavailable entries; otherwise the native alarm state, including transitions. Full accessible text and the sheet expose the separate alarm/lock/garage facts. Use sensible singular/plural copy; no three-line microtext.
- "All doors secured" means every included lock is positively Locked and every included garage/door positively Closed; it says nothing about an alarm being armed. Never let unknown, unavailable, jammed or transitional values fall into a catch-all Locked/Closed branch.
- The capacity algorithm reserves a real touch-sized overflow slot. Example: five entry devices and four slots -> three shown + **2 more**, not four shown + a tiny non-tappable badge. The alarm area is not counted as an entry slot.
- The complete Security overview has the six consistent accessory tiles, including alarm. Tapping each opens its native controls and Back returns to the overview. All explicit custom-sheet title/entity/style settings use the same implementation as other HomeGrid blocks.
- Existing block sizes never grow themselves into other cells. Resizing is an editor operation. No automatic replacement of the current separate house tiles is authorized by this handoff.

## 7. Implementation map and sequence

Canonical shared source is `web/hk`, with validation/decisions in `hk_core`. Build for both Mantel Server and HK Frontend; do not edit generated/staged deployment copies or write host-specific duplicates.

| Owning source | Work |
|---|---|
| `hk_core/settings/home_grid.py` | Common interaction/custom-sheet schema, entry validation, entity enumeration and permission filtering, new Security presentation and Compact size; preserve strict writes/tolerant reads. |
| `web/hk/cards/hk-grid-catalog.js` | Catalog/schema/size parity and Security routing; avoid making custom popup availability depend on a card-specific `opts.tap` declaration. |
| `web/hk/panels/hk-grid-editor.js` | Common When Tapped UI, sheet/entity editor, preview, local appearance, multi-add, duplication/copy, correct labels and resize availability. |
| `web/hk/cards/hk-base.js` | Common open/detail routing and native design helpers; only add named shared tokens when necessary. Preserve existing control event exclusion. |
| `web/hk/cards/hk-layout.js` and `web/hk/cards/hk-strategy.js` | Pass block metadata and context through ordinary, conditional and paged blocks; ensure primary activation and nested controls behave correctly for every catalog kind. |
| `web/hk/cards/hk-detail.js` | Existing shell, appearance context, focus/Back/scroll restoration and width-kind handling; extend through the native group mechanism. |
| `web/hk/sheets/hk-sheet-group.js` | Existing `GroupPanel`, `groupTile`, `openGroup`, `restoreGroup`, native child construction/bridging; extend to ordered entries, local overrides and both tile styles while keeping legacy callers unchanged. |
| `web/hk/cards/hk-tile.js` and `web/hk/elements/hk-elements.js` | Reuse native tiles, secondary-line/active states and optical glyph helpers; fix shared behavior only when required, with regression checks. |
| `web/hk/grid-cards/hk-grid-security.js` | New opt-in size compositions and robust state aggregation; remove no legacy keypad behavior. |
| `web/hk/cards/hk-security.js`, `web/hk/sheets/hk-sheet-security.js`, `web/hk/sheets/hk-sheet-lock.js` | Native keypad and lock/garage control destinations; reuse PIN and hold behavior rather than duplicating it. |
| `web/hk/panels/hk-settings-model.js` and host adapters/settings exposure as needed | Reuse option labels and inheritance; expose new fields consistently to editor/imports/MCP where relevant without bypassing server guards. |

Recommended implementation order:

1. Add the common schema, permission filtering and backward-compatibility tests before changing visible behavior.
2. Extend native group sheets to accept entry configurations and Home/Tall inheritance; preserve all current callers.
3. Add the common block tap option and per-entity editor, preview, bulk add, reorder and duplication/copy.
4. Audit and exercise the common tap option on every catalog block, including controls/pagers/rules/Edit mode.
5. Add the five opt-in Security presentations and Compact footprint, reusing the sheet/entity machinery.
6. Complete the full appearance/format matrix and state/overflow checks; visually compare native and popup accessories at equal scale.
7. Update design/HomeGrid documentation and user guide, then run required release checks. A future release/deployment and live dashboard setup are separate work, not implicit in this planning request.

## 8. Verification and acceptance

### Meaningful automated checks

- JS/Python schema round-trip/parity; legacy configs unchanged; version handling; invalid IDs/fields/bounds; same-entity repeated entries with unique IDs; duplicate ID rejection.
- New entities participate in view filtering and save authorization. Test permissions removed while the sheet is open, empty filtered sheets, missing entities, imported/copied sheets and configuration summaries.
- Duplication is a deep copy with new nested IDs; changing entity/appearance/order in one copy cannot change the source. Unsaved Cancel leaves stored settings untouched; Done/reload restores the same result.
- Table-driven coverage of **all catalog kinds** for custom detail availability and actual open behavior; default and per-card original behavior restored correctly. Test a simple accessory, scene/action, thermostat controls, media transport, camera, full-control card, pager, conditional block and Edit mode explicitly.
- Native group callers still work. Test Back through a device sheet with scroll/style/entry overrides preserved; repeated open/close does not leak children, observers, listeners or subscriptions.
- Security state table includes locked/unlocked, closed/open, all native moving states, jammed, unknown, unavailable, missing alarm, triggered, armed, disarmed and denied control. No `else -> Locked` shortcut and no hidden-device count leak.
- Five footprint placements, Compact size parity, presentation switching, resize/save/import/copy, capacity/overflow arithmetic and read compatibility for old L/XL keypads.
- Visual/style tests cover white active backgrounds, correct dark secondary ink, native on/off icon pairs, large optical HomeView glyphs, both cell shapes, near-square selection, long names and mixed per-entry styles.
- Hold-to-open fires exactly once, early release/cancel/close does nothing, release after success does not reverse it; native alarm/PIN checks unchanged. Use fake clients and block service calls.

Existing relevant suites/checks include:

- `tests/test_hk_core_home_grid.py`, `tests/test_hk_core_home_grid_cards.py`, boundary/shell/permission suites.
- `hosts/ha/custom_components/hk_frontend/tests/test_homegrid.js`, `test_gridcards.js`, `test_blocks_home.js`, `test_blocks_tiles.js`, `test_edit_grid.js`, `test_detail.js`.
- Existing CSS snapshot, type/radii/surface/textscale/pill geometry/glass/Flat/motion tests and theme token checks. Review intended snapshot changes; do not blanket-update unrelated failures.
- `tools/headless/block_taps_check.py`, `grid_blocks_check.py`, `grid_panels_check.py`, `home_grid_visual_check.py --homeview`, `home_grid_audit.py`, `bright_glass_check.py`; add focused shared-popup coverage and register inputs in `tools/ci.py` as appropriate.
- Follow the documented build/test environment and run `tools/ci.py quick` and affected `full` checks before delivery. A skipped browser or host check must be reported as skipped, not passed. The historical DESIGN.md HK Frontend paths map to the HA build's suites in this repo.

### Visual/device evidence matrix

Use Chromium and WebKit with recorded screenshots of **actual production components**, not these concept fragments. At minimum:

| Axis | Required cases |
|---|---|
| Appearance | Glass, Frosted, Tinted, Blur all three modes, Bright Glass all three modes; Flat Light and Flat Dark; light host-page context where applicable. |
| Size/shape | Security S/W/C/L/XL on square and 196 x 150 tile cells; near-square grouped tiles around the recent ~179 px regression; larger-than-196 cells. |
| Popup layout | Same as Screen, Home, Tall/HomeView; per-entry overrides and mixed rows; default and local colors/icons; same and different names/secondary lines. |
| Entity count | 0 after filtering, 1, 2, 6, odd count, 12 and supported maximum; custom sheets on unrelated block kinds. |
| Viewport | 320 px narrow phone, 390 x 844, 844 x 390, 820 x 1180, 1180 x 820, 1280 desktop, 800 x 800 Square, and a short 1280 x 480 car-like viewport. |
| Context | Tab bar, Side Pane on each side, docked menu, safe areas, browser zoom, increased text size, Reduce Motion, read-only/commands disabled. |
| State | All secured, one visible unlocked, hidden Crawl Space equivalent unlocked, garage open, alarm armed/triggered, unavailable/moving device, real-time changes while scrolled/holding. |

The required visual review is against adjacent real accessory tiles at the same effective scale. Confirm baseline alignment, optical glyph size, name/state positions, white active treatment, native header/Close placement, no clipping, reachable Back/Close and no nested blur rectangles while opening/scrolling. Inspect phone and tablet layouts; do not just assert class names or compare JSON.

Record a real iPad/Safari touch review for glyph scale, readability, sheet scrolling, 44 px effective targets, hold cancellation, focus return and motion feel. Automated browser passes do not substitute for that acceptance. Initial visual/test data must remain fictional and command-free; operating real security devices is not part of this handoff.

### Definition of done

- Every HomeGrid card can opt into the same custom detail-sheet system.
- Title/entities/order, sheet style and local per-entry appearance survive save/reload and reset correctly.
- Bulk add, entry duplication, independent sheet copy and block duplication work without shared references or lost configuration.
- The Security block offers all five new compositions, including the genuine 3 x 1 footprint, while all existing saved layouts/keypads keep their behavior.
- The review's six-accessory overview can be rendered in both Home and Tall/HomeView styles, with native controls and correct white active states.
- All allowed entities remain reachable in the full sheet; constrained cards show accurate "N more" and full-set summaries.
- The appearance/device/state matrix is covered, relevant checks pass, and any remaining device acceptance or unavailable environment is explicitly recorded.
- Final handoff includes changed files, screenshots, check results, known limitations and precise release/setup status. No deployment, house setting change or real device operation is implied by completing this plan.
