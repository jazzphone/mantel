# Phase 12: Mantel's MCP server — an assistant that can set up the house (plan 2026-10-31; built 2026-10-31)

The ask: an **MCP server built into Mantel Server**, so an assistant (Claude Code, Claude Desktop, any MCP client)
can read the house, **change settings** and **build screens and dashboards**, safely enough to make setting up a
new house, a new tablet or a new screen a conversation instead of an afternoon in Mantel Settings.

Where it came from: on 2026-10-31 Music Assistant moved from the HA add-on to its own machine and every playlist
pill's `library://playlist/<id>` link went stale. The fix (12 pills remapped by name, one preset's group renamed)
was done by borrowing the Owner's signed-in browser session and sending the Music page's own `settings_write`
frames. That worked *because* Mantel's gateway checked and audited every save, and it is exactly what an MCP
server should make normal: the same frames, a real credential, a named actor in the audit log.

**Status: built, all slices (M12.1–M12.7).** Code: `hosts/server/mantel_server/mcp/`. User guide:
[Assistants](../guide/Assistants.md). Tests: `tests/test_mcp.py`, `tests/test_mantel_settings_assistants.py`.
The changes made to the first draft after review are listed at the end ("What changed from the first plan").

## The principle: MCP is another door, not another way in

Mantel already has one path for everything that changes something, and the MCP server adds **no new authority**:

| What | Today's path | The MCP tool sends (mcp/dispatch.py) |
|---|---|---|
| Reads | a page's `read` frame, routed by `app["read_routes"]` | the same frame, to the same `ws_handlers["read"]`, with the person's principal |
| Settings saves | `settings_write {id, msg}` → `SettingsService.save` (`SAVE_KINDS`, `WRITE_KEYS`, hk_core's checks, RBAC `configure`) | the same `msg`, to the same `SettingsService.save` |
| Music settings | `settings_write` `hk_music/*` → feature_pages → music.py `settings_write` | the same |
| Screens | `POST/PUT/DELETE /api/screens` (screens.py) | screens.py's own functions (`add`, `change`, `remove`), which the REST routes now call too |
| House commands | gateway.py: RBAC on every entity, **audit row first**, then forwarded | `Gateway.handle`, the same frame (opt-in, below) |

So the MCP module is a **translator**: JSON-RPC in, Mantel's existing calls out, answers back. It never writes a
settings document itself, and never reaches Home Assistant except through the gateway. If a save would be refused
on the Settings page, it is refused here with the same code, fields and words.

## Where it lives

`hosts/server/mantel_server/mcp/`:

| Module | What it is |
|---|---|
| `config.py` | the house's switches (below), in the `server_settings` table |
| `grants.py` | a credential: a person's `mcp` session plus its ceiling (scopes); personal keys |
| `auth.py` | who is calling `/mcp`: the bearer, its door, its person, its scopes; rate limits |
| `protocol.py` | `/mcp`: Streamable HTTP, both protocol eras, hand-written on aiohttp (no new dependency) |
| `dispatch.py` | a tool call as a page's read / save / command; plan, then apply; the audit row first |
| `plans.py` | the signed plan handle |
| `tools/` | `house.py`, `settings.py`, `screens.py`, `music.py`, `deploy.py`, `audit.py`, `commands.py` |
| `resources.py` | resources and prompts |
| `oauth.py` | signing an assistant in: OAuth 2.1 + PKCE, registration, consent, tokens, revocation |
| `preview.py` | a screen's read-only preview link |
| `admin.py` | the REST behind Mantel Settings' page |

Outside the package: `dry_run.py` (planning without writing, below), migration `0028_mcp.sql`
(`mcp_grants`, `mcp_clients`, `mcp_codes`; `via` on `action_audit` and `settings_history`), `sessions.Identity`
gains `via` and `read_only`, and `web/shim/settings/assistants.js` is the page.

## The transport: both eras on one endpoint

MCP's current revision (**2026-07-28**) is stateless: no `initialize`, no `Mcp-Session-Id`, no GET stream; every
request carries its protocol version in `params._meta`, `server/discover` is required, results carry
`resultType`, list results `ttlMs` and `cacheScope`, and `Mcp-Method` / `Mcp-Name` headers mirror the body.
Clients in use still speak the handshake era too, so `/mcp` serves both (the spec's "dual-era server"):

- A request with `_meta["io.modelcontextprotocol/protocolVersion"]` is served as 2026-07-28: the headers must
  match the body (`-32020 HeaderMismatch`, Base64-sentinel `Mcp-Name` decoded first), an unknown version is
  `-32022` with the supported list, an unknown method is HTTP 404 with `-32601`.
- `initialize` is answered as the legacy revision it asks for (2025-11-25, 2025-06-18, 2025-03-26), with no
  session id: none is needed, because nothing is kept between requests. `ping` and `logging/setLevel` answer `{}`.
- One JSON-RPC message per POST (no batches), every answer `application/json`, notifications `202`. GET and
  DELETE are `405`. Nothing is ever sent unasked (no sampling, no elicitation, no list changes, so no stream).
- **Before anything else**: an `Origin` header that isn't Mantel's own address is `403` (DNS rebinding); the body
  is at most 1 MB of JSON; the caller is authenticated (`401` with `WWW-Authenticate: Bearer
  resource_metadata="…/.well-known/oauth-protected-resource/mcp"`, RFC 9728); then the rate limit (600
  requests a minute per assistant).

Verified with the official MCP Python SDK (2.3.0): its `auto` mode negotiates 2026-07-28 through
`server/discover`, its `legacy` mode 2025-11-25 through `initialize`; tools, resources, prompts, a planned and
applied change, a refusal as a tool error, and its OAuth client end to end.

## Who is calling: a person, with a ceiling

An assistant acts **for a person**, never as a role of its own, so RBAC is the person's own and the audit log
names them, with `via = mcp:<assistant name>`. Every credential is a `sessions` row of method `mcp` (Me →
Sessions lists it; its Revoke, "sign out everywhere" and a disabled person end it) plus a grant (`mcp_grants`)
with its ceiling. A browser cookie, an app's bearer and an assistant's token are never accepted for one another.

**Only Owners and Admins** may have one, checked when it is made **and on every request** (a person moved to
Adult loses their assistant's access at once).

**A personal key**: Mantel Settings → Advanced → Assistants → *New Personal Key…* gives
`mmcp_<16 hex>_<43 base64url>` once (SHA-256 stored, constant-time compare), with scopes and the house's key
lifetime (30 days by default). Making one needs a fresh sign-in (as adding a passkey does). **Home network only,
always; never the `commands` scope.**

**OAuth 2.1 with PKCE** (M12.5), for clients that sign in:

1. `/.well-known/oauth-protected-resource[/mcp]` (RFC 9728) and `/.well-known/oauth-authorization-server`
   (RFC 8414, with `authorization_response_iss_parameter_supported`).
2. Registration (RFC 7591, `POST /mcp/oauth/register`): a name and 1–5 redirect URIs, `https` or `http` on
   loopback only; public clients (`token_endpoint_auth_method: none`). Ten an hour per address, at most 200
   clients, an unused one forgotten after 30 days. **Client ID Metadata Documents are not offered**
   (`client_id_metadata_document_supported: false`): fetching a URL a stranger names, from inside a home network,
   is a server-side request Mantel won't make. Clients fall back to registration, as the spec says.
3. `/mcp/oauth/authorize`: Mantel's own sign-in first (every factor Mantel has), then a consent page naming the
   assistant, the person, **the address it returns to**, and the scopes as ticks; `commands` offered only while
   the house allows it, "from away" only while `mcp_away` is on. Allow is a form POST with the session's CSRF
   token, audited (`mcp.grant`) before the code is made. The page can't be framed (`frame-ancestors 'none'`,
   `X-Frame-Options: DENY`), and its CSP's `form-action` names the registered redirect's origin.
4. `/mcp/oauth/token`: the code (single use, 60 s, bound to client, redirect URI, S256 challenge, scopes) for an
   access token (15 min) and a refresh token rotated on use (a reused one ends the family and the grant). A
   `resource` (RFC 8707), when sent, must be this `/mcp`. The redirect carries `iss` (RFC 9207).
5. `/mcp/oauth/revoke` (RFC 7009).

**MCP scopes (the ceiling):**

| Scope | Allows | Default |
|---|---|---|
| `read` | states, rooms, settings, screens, music settings, the library | on |
| `settings` | settings saves (house, screens' settings, tablets, accessories, music), batches | on |
| `screens` | add, rename, move, remove screens; Home Grid; export/import; templates; previews | on |
| `audit` | the audit log and settings history | off |
| `restore` | `mantel/settings/restore` | off |
| `commands` | house commands through the gateway (sign-in only, house switch on) | **off** |

The alarm stays out of reach (its commands need the house Alarm PIN; `house_command` refuses the
`alarm_control_panel` domain and a handful of system ones outright). People, roles, passkeys, connections'
secrets and service accounts have **no tools at all**.

## The house's switches (Mantel Settings → Advanced → Assistants (MCP))

| Key | Default | |
|---|---|---|
| `mcp_enabled` | off | `/mcp` answers at all; off refuses every credential (kept) |
| `mcp_away` | off | a signed-in assistant allowed "from away" may use the tunnel door; keys never |
| `mcp_commands` | off | the `commands` scope may be given (sign-in only) and is honoured; needs Allow Control of the House |
| `mcp_write_rate` | 60 | applied changes per minute per assistant |
| `mcp_key_days` | 30 | a new key's lifetime (1–365) |

Only an Owner changes them; each change is audited (`mcp.settings`) before it is made and applies to the next
request. The page also shows the address to connect to, how to connect Claude Code and Claude Desktop, and every
assistant (an Owner sees everyone's, an Admin their own) with Revoke (`mcp.revoke`). The Audit Log page gains a
**Through** filter (any / an assistant / none; `GET /api/audit?via=`) and names the assistant on each row.

## The tools (38)

Names are `area_verb`. Each says the scope it needs; `tools/list` lists only the caller's, in a fixed order, with
`readOnlyHint` / `destructiveHint` / `idempotentHint`. Arguments are checked strictly against the schema (no
unknown keys) before anything runs.

| Area | Tools |
|---|---|
| House (`read`) | `house_summary`, `house_find`, `house_states`, `rooms_list` (only what the person may `view`) |
| Settings | `settings_get`, `settings_schema` (`read`); `settings_change`, `accessory_set` (`settings`); `settings_history` (`audit`); `settings_restore` (`restore`) |
| Screens (`screens`) | `screens_list`, `screen_get` (`read`); `screen_create`, `screen_rename`, `screen_move`, `screen_remove`, `grid_cards`, `grid_starter`, `grid_set`, `grid_place`, `grid_remove` |
| Music | `music_settings`, `music_library` (`read`); `music_playlist_save`, `music_preset_save`, `music_item_remove`, `music_pills_order`, `music_settings_set`, `music_relink` (`settings`) |
| Deploying | `settings_apply` (`settings`); `screen_export`, `screen_import`, `screen_templates`, `screen_from_template`, `screen_preview` (`screens`); `tablet_setup` (`settings`) |
| Audit / commands | `audit_recent` (`audit`); `house_command` (`commands`) |

`settings_schema` is made from hk_core's own check tables (`changes.HOUSE`, `BOARD`, `TABLET`: each key's kind,
the choices and entity domains its check closes over) and defaults, so it can't drift from what saves accept
(a test pins its keys to `changes.BOARD`). An assistant's screens are Mantel's own (`where: mantel`): making or
removing one in Home Assistant reaches Home Assistant outside the gateway, so those stay Mantel Settings'.

**Resources**: `mantel://house`, `mantel://screens`, `mantel://screens/{key}`, `mantel://settings/schema/{scope}`,
`mantel://grid/cards`, `mantel://guide` and `mantel://guide/{page}` (the /docs pages' Markdown). **Prompts**: *Set
up a wall tablet*, *Build a Home Grid for a room*, *Copy a screen to another room*, *Fix Music after a library
change*, *What changed recently?*

## Changing things safely

- **Plan, then apply, with no session.** Every write tool runs dry first (`dry_run` defaults to true). The change
  runs exactly as a real one, every check included, up to the one place every settings change ends,
  `SettingsStore.write` / `remove`. There, inside a plan (`dry_run.py`, a context variable), the store works out
  the new versions and diffs, **writes nothing** and raises `Planned`, so nothing after it runs either (no publish,
  no feed), and `audit.config` writes no row. A tool with several saves has each planned and collected. The answer
  is the diff of every document and a **plan**: a handle the server signs (HMAC, per-process key) naming the tool,
  a digest of its exact arguments, the grant, the versions read, and ten minutes. Applying is the same call with
  `dry_run: false` and that plan: other arguments (`plan_mismatch`), another assistant or a forged handle
  (`plan_invalid`), too late (`plan_expired`) or a document changed meanwhile (`conflict`) is refused and nothing
  is written. A test checks, tool by tool, that a plan leaves the database byte-for-byte as it was.
- **The audit row first.** An applied change writes `mcp.<tool>` (the documents, the arguments, `via`) before it
  runs; no row, no change (`audit_unavailable`). Screens and the gateway write their own rows as well.
- **Batches are one plan.** `settings_apply {steps: [{tool, arguments}]}` (up to 20) plans every step against the
  house as it is, shows them together and applies them in order under one plan. A refusal while applying stops
  it and answers what landed and how to undo it. (A new screen's settings and Home Grid go in its
  `screen_create`, so a step never depends on an earlier one.)
- **Everything is reversible.** Every applied change answers `{scope, key, version, previous, undo}`; the undo is
  `settings_restore` to `previous`. Removed screens keep their history.
- **Rate limits**: applied changes per minute per assistant (`mcp_write_rate`); requests per minute (600).
- **The kill switch and Allow Control of the House** apply exactly as they do to pages; settings saves still
  work with commands off.

## Making deploying easy

1. **A new tablet, end to end**: `house_summary` → `screen_create {copy_from}` or `screen_from_template` →
   `grid_set` → `tablet_setup {tablet, screen}`, which also answers the link a person opens **on the tablet** to
   enrol it (`/settings#/mantel/devices/enroll/<tablet>`): enrolment trusts a device, so it stays a person's step.
2. **Screens as files**: `screen_export` (board, Home Grid, per-screen accessory names, and every entity it names
   with its name and room) and `screen_import` (entities this house lacks matched by domain + name + room, then
   name alone, or by `mapping`; unmatched ones refuse unless `allow_unmatched`; settings hk_core doesn't take are
   reported, not kept).
3. **Templates**: kitchen, hallway, family, nightstand, guest room, living room: Home Grid starter recipes filled
   from *this* house when used, so a template never carries another house's entities.
4. **Moving infrastructure**: `music_relink` matches pills whose `library://` links are gone to the library
   playlist of the pill's name (or its chooser's; accents and case forgiven), when exactly one has it and the pill
   has one dead link, or by `mapping`; every fix and every link with no match is in the plan.

## Previews

On the client side, as preferred: `screen_preview` answers a one-time link (`/mcp/preview/<code>`, five minutes,
in memory only) that the assistant's own browser opens. It starts a **read-only** browser session (method
`mcp_preview`, ten minutes, no refresh) for the person and lands on the screen. Read-only is enforced in the
session middleware and every guard (no unsafe method; no Settings, admin, people, devices, audit, connections,
backups, `/ma` or `/go2rtc` even to look), on the screen's socket (reads only), in the gateway (no command) and in
the media proxy. A browser already signed in as that person just opens the screen; one signed in as someone else
is refused rather than signed out.

## Slices (all done)

| Slice | What | Checked by |
|---|---|---|
| M12.1 | Transport (both eras), keys, Assistants page, the audit's `via` | transport, key, door, revoke, role tests; the SDK in both modes |
| M12.2 | Read tools, resources, prompts | house/schema/resources tests |
| M12.3 | Settings and Music writes, plans, `expect_version`, rate limit, history/restore | plan/apply/conflict tests; `music_relink` against a fake library |
| M12.4 | Screens and Home Grid, `settings_apply` | screen/grid/batch tests |
| M12.5 | OAuth 2.1 | the flow end to end in tests and with the SDK's OAuth client |
| M12.6 | Export/import, templates, prompts, tablet setup, previews | export/import/template/preview tests |
| M12.7 | `house_command` (sign-in + house switch), `audit_recent` | commands and audit tests |

## Decisions (the open questions)

| # | Question | Decided |
|---|---|---|
| 1 | Who may connect an assistant? | Owners and Admins, checked on every request |
| 2 | Tunnel door at all? | Sign-ins only, and only while the Owner turns on `mcp_away` and the grant was allowed away; keys never |
| 3 | `dry_run` default true, or `*_plan` tools? | Default true, enforced by the signed plan handle |
| 4 | Commands scope ever on for a key? | No: sign-in consent only, and the house switch |
| 5 | Does HK Frontend get the same tools? | No (decision 29); HK Frontend users have HA's own MCP server |
| 6 | Preview in the image or on the client? | On the client (one-time read-only link) |

## What changed from the first plan

- **The transport follows MCP 2026-07-28** (stateless, `server/discover`, header checks) and still answers the
  `initialize` era; the first draft was written for sessions and a GET stream.
- **`dry_run` "first call in a session" became a signed plan handle**, since the protocol keeps no session.
- **Registration only, no Client ID Metadata Documents** (see M12.5), and `resource` / `iss` handled.
- **Mantel Settings → Advanced → Assistants (MCP)** holds every switch and the list (the first draft split them
  between Connections and Me).
- **Every applied change is audited** as `mcp.<tool>`, not only the gateway's commands.
- **Screens in Home Assistant stay Mantel Settings'** (creating one calls Home Assistant outside the gateway).
- **Claude Desktop on the home network** connects through its config file (`mcp-remote` with a key); claude.ai's
  own connectors reach a server from Anthropic's cloud, so they need the tunnel door and a sign-in.
- **A preview can only look**, and never at Settings.
