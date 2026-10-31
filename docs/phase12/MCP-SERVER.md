# Phase 12: Mantel's MCP server — an assistant that can set up the house (plan, 2026-10-31)

The ask: an **MCP server built into Mantel Server**, so an assistant (Claude Code, Claude Desktop, any MCP client)
can read the house, **change settings** and **build screens and dashboards**, safely enough to make setting up a
new house, a new tablet or a new screen a conversation instead of an afternoon in Mantel Settings.

Where it came from: on 2026-10-31 Music Assistant moved from the HA add-on to its own machine and every playlist
pill's `library://playlist/<id>` link went stale. The fix (12 pills remapped by name, one preset's group renamed)
was done by borrowing the Owner's signed-in browser session and sending the Music page's own `settings_write`
frames. That worked *because* Mantel's gateway checked and audited every save, and it is exactly what an MCP
server should make normal: the same frames, a real credential, a named actor in the audit log.

**Status: plan. Nothing built.** Open questions are at the end.

## The principle: MCP is another door, not another way in

Mantel already has one path for everything that changes something, and the MCP server adds **no new authority**:

| What | Today's path | The MCP tool sends |
|---|---|---|
| Reads | a page's `read` / `read_subscribe` frame, routed by `app["read_routes"]` | the same read, same RBAC (`view`) |
| Settings saves | `settings_write {id, msg}` → `settings_result` (settings_store/service.py, hooks.py `SAVE_KINDS`, `WRITE_KEYS`) | the same frame; checked by `hk_core/settings/changes.py`, versioned, in `settings_history` |
| Music settings | `settings_write` `hk_music/*` → music.py `settings_write` (feature_pages.py routes) | the same |
| Screens | `POST/PUT/DELETE /api/screens` (screens.py), Owner/Admin, audited first | the same handlers, called in-process |
| House commands | gateway.py: RBAC on the rooms named, **audit row first**, then forwarded | the same gateway (opt-in, below) |

So the MCP module is a **translator**: JSON-RPC in, Mantel's existing frames out, answers back. It never touches
`SettingsStore` directly, never writes a document body whole, never reaches Home Assistant except through the
gateway. If a save would be refused on the Settings page, it is refused here with the same message.

## Where it lives

- **`hosts/server/mantel_server/mcp/`**, a package beside `settings_store/`:
  - `transport.py`: MCP's **Streamable HTTP** transport on aiohttp at **`/mcp`** (POST for JSON-RPC; GET for the
    server→client SSE stream; `Mcp-Session-Id`). The protocol is small (initialize, `tools/list`, `tools/call`,
    `resources/*`, `prompts/*`, notifications); hand-written on aiohttp it adds **no dependency**, which keeps the
    App image as it is. (The `mcp` Python SDK is Starlette/ASGI; mounting it would add a second web stack.)
  - `auth.py`: who is calling (next section).
  - `tools/`: one module per area (`house.py`, `settings.py`, `screens.py`, `music.py`, `commands.py`,
    `audit.py`), each a list of `Tool(name, description, input_schema, needs, handler)`.
  - `dispatch.py`: turns a tool call into the existing frame with an `Identity` and an `Actor`, so RBAC, history
    and the audit log see one caller, `mcp:<client name>` on behalf of a person.
- **Doors**: `lan` by default. `tunnel` only if the Owner turns it on (Mantel Settings → Connections → Assistants),
  and then only with OAuth tokens, never the static key.
- **Off by default.** Mantel Settings → Connections → **Assistants (MCP)**: on/off, the connected clients, their
  scopes, last used, Revoke.

## Who is calling: a person, with a ceiling

An assistant acts **for a person**, never as a role of its own, so RBAC is the person's own and the audit log
names them. On top of that, each credential carries a **ceiling** (its MCP scopes), so "the Owner's Claude" can be
weaker than the Owner.

**OAuth 2.1 with PKCE (the main way).** MCP's authorization spec is OAuth 2.1, and Mantel already runs that flow
for the Apple apps (app_auth.py: `/app/authorize`, PKCE S256, refresh families in `sessions`). The MCP server
reuses it:

1. The client finds Mantel's metadata (`/.well-known/oauth-protected-resource`,
   `/.well-known/oauth-authorization-server`) and registers itself (dynamic client registration, RFC 7591:
   a name and a redirect URI, stored in a new `mcp_clients` table).
2. The browser opens Mantel's sign-in (passkey, password + TOTP, Sign in with HA: every factor Mantel has), then a
   consent page: **"Allow Claude Code to read the house and change settings as <name>?"** with the scopes as
   checkboxes.
3. Tokens: access 15 minutes, refresh rotated on use (the same reuse detection as browsers' sessions). The
   `sessions` row is method `mcp`, so Settings → Me → Sessions lists it and Revoke ends it.

DPoP (the Apple apps' key binding) is optional here: most MCP clients don't send proofs yet.

**A personal key (the fallback).** For clients without OAuth, or a script: Settings → Me → Assistants → *Make a
key* gives `mmcp_<id>_<secret>` once (stored as SHA-256, like service accounts' `msvc_` credentials), with
scopes, an expiry (30 days by default) and `lan` only.

**MCP scopes (the ceiling):**

| Scope | Allows | Default |
|---|---|---|
| `read` | states, rooms, settings, screens, music settings, the library | on |
| `settings` | settings saves (house, screens' settings, tablets, accessories, music) | on |
| `screens` | add, rename, copy, remove screens; Home Grid layouts | on |
| `audit` | read the audit log and settings history | off |
| `commands` | house commands through the gateway (lights, media, scenes...) | **off** |
| `restore` | `mantel/settings/restore` (roll a document back) | off |

The alarm stays out of reach: its commands need the house Alarm PIN, and an assistant is never given it. Role
changes, people, passkeys, connections' secrets and service accounts get **no tools at all**, whatever the scope.

## The tools

Names are `area_verb`. Every write tool takes **`dry_run`** (default **true** for the first call in a session's
change, see "Changing things safely"), returns **what changed** (the diff `settings_history` records) and the new
version, and takes `expect_version` where the save supports it (board/set, settings/set, accessories), so two
editors never overwrite each other.

### Reading the house

| Tool | Answers | Built on |
|---|---|---|
| `house_summary` | floors, rooms, counts, the house's screens and tablets, Mantel's version, what's connected | panel/get, hub |
| `house_find` | entities by name, room, domain or feature (`"kitchen lights"`) | hub registries |
| `house_states` | current state and the attributes that matter for given entities | hub snapshot |
| `rooms_list` | rooms with their accessories, in the Home page's order | accessories document |

### Settings

| Tool | Does | Built on |
|---|---|---|
| `settings_get` | one scope's merged settings (`house`, `board/<screen>`, `tablet/<id>`, `music`) with its version | `mantel/settings/get` |
| `settings_schema` | the keys a scope accepts, their types, allowed values and defaults | `hk_core/settings/model.py` (`BOARD_DEFAULTS`, the `pick` sets) |
| `settings_change` | `{scope, changes, expect_version?, dry_run}` | `hk_frontend/settings/set`, `board/set`, `tablet/set` |
| `settings_history` | a document's versions: who, when, which message, the diff | `mantel/settings/history` |
| `settings_restore` | make a new version from an old one (`restore` scope) | `mantel/settings/restore` |
| `accessory_set` | name, icon, room, hidden, favorite... for one entity | `hk_frontend/accessory/*`, `hidden/*` |

`settings_schema` is what makes the assistant good at this: it is generated from hk_core's model, so the tool
descriptions never drift from what the checks accept (a test pins them, as `SAVE_KINDS` is pinned).

### Screens and dashboards

| Tool | Does | Built on |
|---|---|---|
| `screens_list` | every screen: address, title, who draws it (`mantel`/`ha`), Home Style, which tablets use it | board documents, screens.py |
| `screen_get` | one screen's whole board, its Home Grid and the menu it shows | `board()` |
| `screen_create` | `{title, where, copy_from?}` | `POST /api/screens` |
| `screen_rename` / `screen_move` / `screen_remove` | title, where, delete (refused while a tablet uses it) | screens.py |
| `grid_cards` | the Home Grid card catalogue: each card's sizes (S…XXL), options and page sources | the card registry the editor reads |
| `grid_starter` | a starter layout for a screen (by room, by tablet size) | `hk_frontend/grid/starter` |
| `grid_set` | write a screen's `home_grid` whole: `{v, cols, rows, frame, band, items}` | `board/set` (`changes: {home_grid}`) |
| `grid_place` / `grid_remove` | add, move or resize one block; remove one | the same, read-modify-write with `expect_version` |
| `screen_preview` | a PNG of the screen as a tablet draws it | later: see "Previews" |

Home Grid's rules (no overlap, inside the grid, a size the card supports, `cols` 6/3/2, `rows` 2–6) are checked
by hk_core on save, so a bad layout is refused with the field and the reason, and the assistant fixes it. The
`dry_run` answer includes the checked layout, so it can iterate without writing.

### Music

| Tool | Does | Built on |
|---|---|---|
| `music_settings` | speakers, volume, home rooms, presets, pills (with each link's playlist name) | `hk_music/settings/get` |
| `music_library` | Music Assistant's playlists (and albums, artists) with their `library://` links | `music_assistant/get_library` read |
| `music_playlist_save` / `music_preset_save` / `music_item_remove` / `music_pills_order` | the Music page's saves | `hk_music/*` settings writes |
| `music_relink` | pills whose links aren't in the library, with a proposed match by name; `dry_run` then apply | music.py's library check + the saves |

`music_relink` is the 2026-10-31 fix as one tool. `music_settings` flags dead links the way `gone_from_library`
already does (hk_core/music/engine.py).

### Commands (opt-in, `commands` scope)

`house_command {domain, service, target, data}` through the gateway, with the same refusals as a page. No
batching, and no alarm. Off until the Owner gives a client the scope.

### Audit (`audit` scope)

`audit_recent {since?, actor?, kind?}`: Mantel's audit rows, so an assistant can answer "what changed this week?"
and check its own work.

### Resources and prompts

- **Resources** (read-only context a client can attach): `mantel://house`, `mantel://screens/<key>`,
  `mantel://settings/schema/<scope>`, `mantel://grid/cards`, and the user guide (`docs/guide/*.md`, as Mantel
  Settings → About → Documentation serves it).
- **Prompts** (one-click starting points in clients that show them): *Set up a wall tablet*, *Build a Home Grid
  for a room*, *Copy a screen to another room*, *Fix Music after a library change*, *What changed recently?*

## Changing things safely

- **Plan, then apply.** A write tool's first call in a change is a `dry_run`: it returns the diff, the checks'
  refusals and the versions it read. Applying sends the same arguments with `dry_run: false` and those versions as
  `expect_version`. If anything moved in between, it is a `conflict` and nothing is written.
- **Batches are one change.** `settings_apply {changes: [...]}` runs several saves (for example a new screen, its
  board settings and its Home Grid) as a list: each is checked dry first, then they apply in order. A failure
  stops the batch and answers which steps landed and how to restore them (settings history). (True all-or-nothing
  would need a store transaction across documents. Worth it only if this proves to be a real problem.)
- **Everything is reversible.** Every settings save is a version. The answer to every write includes
  `{scope, key, version, previous}`, so "undo that" is `settings_restore` to `previous`. Screens removed keep
  their history.
- **The audit log says it was an assistant.** `actor` is the person; a new `via` column says `mcp:<client name>`. Mantel Settings → Audit Log can filter on it.
- **Rate limits**: writes per minute per client (default 60), so a looping agent can't churn the history.
- **Read-only kill switch**: the App's Read-only option and Allow Control of the House apply exactly as they do
  to pages. Settings saves still work with commands off, as today.

## Making deploying easy

What "easy" means here, and how the tools above get there:

1. **A new tablet, end to end.** *"Set up the Loft tablet: its own screen, Home Grid, Loft first."* The assistant
   reads the rooms (`house_summary`), copies the closest screen (`screen_create {copy_from}`), lays out a grid from
   `grid_starter` and edits it, sets the tablet's settings, and returns an enrolment link for the Owner to open
   on the tablet (enrolment stays a human step: it trusts a device).
2. **Screens as files.** `screen_export` returns one screen's board, Home Grid and per-screen accessory names as
   JSON, and `screen_import` creates a screen from it (checked like any save, entity ids mapped by name and room
   where the house differs). That makes a **template library** possible (kitchen, nightstand, guest room) and lets
   a second house start from the first's screens.
3. **Whole-house setup from a description.** With 1 and 2, a prompt like *"Every room with a tablet gets a Home
   Grid screen, cameras on the Entry one"* is a batch the assistant plans dry, shows, then applies.
4. **Moving infrastructure.** Today's case: a service moved and links went stale. Tools like `music_relink`
   (and later, entity renames after an integration is re-added: `accessory_relink`, matching by name, area and
   device) turn a migration into one reviewed batch.

## Previews (later)

`screen_preview` needs a browser on the server. Mantel's own render checks use headless WebKit on the Mac
(sheet_review.py, tools/headless). Two options, decided when we get there:

- **In the App image**: Playwright + Chromium adds about 300 MB to the image. Too much for everyone to pay for a
  developer feature.
- **On the client side**: the tool returns a one-time URL for the screen at a given frame size (signed, 5 minutes,
  read-only), and the assistant's own browser opens it. No new weight in Mantel. **Preferred.**

## Slices

| Slice | What | Done when |
|---|---|---|
| **M12.1** | Transport + personal keys: `/mcp` (initialize, tools/list, tools/call), `mmcp_` keys with scopes, Assistants panel (on/off, keys, Revoke), the audit's `via` | Claude Code connects over the LAN with a key; `house_summary` works; a revoked key is refused |
| **M12.2** | Read tools + resources: house, rooms, states, settings_get, settings_schema, screens_list, screen_get, music_settings, music_library | an assistant can describe any screen and the music setup accurately |
| **M12.3** | Settings writes: settings_change, accessory_set, music saves, music_relink, settings_history/restore, dry_run, expect_version, rate limit | the 2026-10-31 relink done with tools alone, visible in the audit as `mcp:` |
| **M12.4** | Screens + Home Grid: screen_create/rename/move/remove, grid_cards, grid_starter, grid_set/place/remove, settings_apply | a new Home Grid screen built from a prompt, drawn correctly on a tablet |
| **M12.5** | OAuth 2.1: metadata, dynamic registration, consent page, `mcp` sessions, Settings → Me → Sessions | Claude Desktop connects by signing in, with no key copied |
| **M12.6** | Deploying: screen_export/import, templates, prompts, the tablet setup flow, preview URLs | a second screen made from the first's export on a fresh Mantel |
| M12.7 (opt-in) | `house_command` with the `commands` scope; `audit_recent` | off by default; on, refused exactly as a page's commands are |

Each slice ships its tests in `hosts/server/tests/` (the transport's JSON-RPC cases; every tool's refusals; a
pin that every tool maps to a frame in `SAVE_KINDS` / `read_routes`, so nothing bypasses the gateway; scope
ceilings; door rules) and runs in `tools/ci.py`.

## Size

| Slices | Rough size |
|---|---|
| M12.1–M12.3 (useful: read + settings + music, with keys) | about a week |
| M12.4 (screens and Home Grid) | 3–4 days |
| M12.5 (OAuth) | 2–3 days (most of it exists in app_auth.py) |
| M12.6 (deploying) | about a week, most of it in export/import's entity mapping |

## Open questions

| # | Question | Leaning |
|---|---|---|
| 1 | Who may connect an assistant? | Owner and Admin only at first; their ceilings as above |
| 2 | Tunnel door at all? | Not in M12.1–M12.4; with OAuth only, Owner's choice, after M12.5 |
| 3 | `dry_run` default true, or a separate `*_plan` tool per write? | default true: one tool per action keeps the list short |
| 4 | Commands scope ever on for a key (not OAuth)? | no: commands only with a signed-in consent |
| 5 | Does HK Frontend get the same tools? | no: Mantel only (decision 29); HK Frontend users have HA's own MCP server |
| 6 | Preview in the image or on the client? | on the client (signed URL) |
