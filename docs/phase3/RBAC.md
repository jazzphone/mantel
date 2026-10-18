# Phase 3 P3.2: roles and grants, and read filtering (2026-10-18)

PLAN.md §5 (roles, grants, step-up) and §7 ("Sensitive actions over the tunnel"), as a pure engine,
a read filter for the state hub, and a storage adapter with Owner-only REST. No command reaches
any device: this slice only *decides*. The command gateway (P3.3) and the read proxies (P3.4) call it.

| File | What |
|---|---|
| `hosts/server/mantel_server/rbac.py` | The engine. Pure: no I/O, no clock, no database. |
| `hosts/server/mantel_server/view.py` | `ClientView(..., gate=)` read-filter hook, `policy_changed()`, `filter_registry()` |
| `hosts/server/mantel_server/registry.py` | Additive: `entries`, `area_floor`, `floors`, `resolve_floor()` for floor and device_class lookups |
| `hosts/server/mantel_server/rbac_store.py` | `RbacStore` over a plain `sqlite3.Connection`; `register(app, hub, identity=...)` REST |
| `hosts/server/mantel_server/migrations/0002_rbac.sql` | `rbac_grants`, `rbac_role_overrides`, `rbac_scopes` |
| `tests/test_rbac.py`, `tests/test_rbac_filter.py`, `tests/test_rbac_store.py`, `tests/rbac_fixtures.py` | 728 tests over a fictional house |

## The model

**Subject** `Subject(user_role, user_id, device_role, device_id, door='lan'|'tunnel', fresh_factor_at,
user_areas, device_areas)`. A request carries a user, an enrolled device, or both. `user_areas` are a
Child's allowed areas or a Guest's rooms. `device_areas` is a wall tablet's room. Both come from
`rbac_scopes` (`RbacStore.subject(...)` fills them in), and they give `@subject` area grants their meaning.

**Grant** `Grant(effect allow|deny, actions, resource_kind, resource, domains, roles, users, devices,
schedule, id, note)`.
- *actions*: `view`, `control`, `control.sensitive`, `history`, `configure`, or `*`.
- *resource kinds*: `entity` (an id, `*` globs allowed), `domain`, `area` (id or name, or `@subject`),
  `floor` (id or name), `feature`, `all`.
- *features*: `cameras` (camera domain), `locations` (person, device_tracker), `garage` (covers with
  device_class garage/gate), plus the non-entity endpoints `music`, `energy`, `notifications`,
  `settings`, `profile`, `users`, `devices`, `roles`, `owners`, `credentials`, `audit`.
- `domains` narrows any resource ("lights in the Loft").
- A role's default grants name no targets: they apply to everyone with the role. A stored grant must
  name at least one role, user or device.

**Schedule** `Schedule(start, end, days, not_before, not_after)` uses wall-clock time in the house's
time zone, which is passed in through `Context.tz`.
- `end < start` crosses midnight (21:00 to 06:00). `days` (Mon=0) names the day the window *starts*
  on, so a Friday 21:00 to 06:00 window covers early Saturday.
- `start == end` means all day.
- `not_before` and `not_after` are absolute bounds. `guest_until(user_id, ts)` time-boxes a guest
  with an explicit deny of everything from `ts` on.
- A scheduled allow counts only inside its window. A scheduled deny binds only inside its window.

**Context** `Context(now, tz, area_of, floor_of, device_class_of, resolve_area, resolve_floor)` holds
the registry lookups and the time. `Context.from_registry(registry, now, tz, states)` builds them
from `registry.Registry`; device_class comes from the registry entry, or failing that from the state
attribute. An unknown `tz` raises at construction rather than guessing.

**Policy** `Policy(roles, grants, step_up_window=300, step_up_exempt=frozenset())`.
`Policy.build(grants, overrides)` applies stored role overrides: their `grants` replace the
defaults, and their switches merge. A new role can also be defined by an override.

**Decision** `Policy.decide(subject, action, entity_id, ctx, *, feature=None) -> Decision(allowed,
needs_step_up, reason, action, sensitive, side)`. The module-level `decide(...)` uses the defaults
unless you pass `policy=`. Rules are applied in this order:

1. **Classify.**
   - Plain actions stand as given.
   - A service (`lock.unlock`, `homeassistant.toggle`) becomes `control`, or `control.sensitive` if
     it is in the sensitive set (below). The check covers both the service's own domain and the
     target's domain, so `homeassistant.toggle` on a lock, or `light.turn_off` aimed at an
     automation, stays sensitive.
   - Anything else is `unknown_action`.
   - Requests with no target get `no_target`, and unknown features get `unknown_feature`.
2. **Device credentials on the tunnel door** are refused: `device_on_tunnel`.
3. **Each side** (user, device) is evaluated on its own: its role's grants, plus stored grants that
   name its role or its id. Deny by default, grants are additive, and an explicit deny wins:
   `explicit_deny` beats `granted`, which beats `no_grant`.
4. **Intersection.** The effective result is the user's ∩ the device's. With no user, the device
   alone decides; with no device, the user alone; with neither, `no_subject`. `side` says which side
   refused.
5. **Tunnel (§7).**
   - Sensitive actions need the role's `tunnel_sensitive` switch, otherwise `tunnel_lan_only`.
   - Cameras need `tunnel_cameras` (`tunnel_cameras_off`).
   - Location history needs `tunnel_locations` (`tunnel_locations_off`).
6. **Step-up.**
   - A sensitive action needs `fresh_factor_at` within `step_up_window` (300 s) of `ctx.now`, and
     not in the future. Otherwise the result is `needs_step_up=True`, reason `step_up_required`.
   - A device alone (a wall tablet with nobody at it) never has a factor: `needs_step_up=True`,
     reason `person_pin_required`. The gateway then asks for a person's PIN at the tablet and decides
     again with that person as the user, so the person's rights ∩ the tablet's rights apply.
   - `needs_step_up` is set only when everything else already allows, so a prompt appears only when
     a PIN would actually help.

**Sensitive set** (fail-closed: in these domains every service is sensitive except the safe ones):

| Kind | Sensitive | Safe |
|---|---|---|
| `lock` | everything else (`unlock`, `open`, a generic toggle) | `lock` |
| `alarm_control_panel` | `alarm_disarm`, `disarm`, anything else | the `alarm_arm_*` services, `alarm_trigger` |
| `garage` (cover, device_class garage/gate) | `open_cover`, `toggle`, `set_cover_position`, ... | `close_cover`, `stop_cover`, tilt close/stop |
| `valve` | every service | none |
| `camera` | `camera.live` (the pseudo-service for live view), `turn_off`, `disable_motion_detection`, `record`, ... | `snapshot`, `turn_on`, `enable_motion_detection` |
| `automation` | every service (`turn_on`/`turn_off`/`toggle`/`trigger`/`reload`) | none |
| `script` | `turn_off`, `toggle`, `reload` | running one (`turn_on`, `script.<name>`) |
| `explicit` | the plain action `control.sensitive` | |

## Starting roles (encoded as data in `rbac.DEFAULT_ROLES`)

| Role | Default grants | Tunnel switches (sensitive / cameras / locations) |
|---|---|---|
| owner | allow `*` on all | on / on / on |
| admin | allow `*` on all; deny `configure` on features `owners`, `credentials` | on / on / on |
| adult | allow view, control, control.sensitive, history on all; configure on `profile` | on / on / on |
| child | allow view, control in `@subject` areas for light, media_player, remote, climate, fan; configure `profile`; deny `*` on cameras, `lock`, `alarm_control_panel`, garage; deny configure on `vacuum` | off / off / off |
| guest | allow view, control in `@subject` areas for light, switch, fan, climate, media_player, remote, cover, scene; deny `*` on cameras, locations, garage; deny `history` on all | off / off / off |
| wall_tablet | allow view, control, control.sensitive, history in `@subject` (its room); `sensitive_needs_person` | n/a: devices are refused on the tunnel |
| service | none: give each endpoint as a feature grant | off / off / off |

Owners always keep every permission: overriding the `owner` role is refused, both through REST and
in the store.

## Decisions, by example

The fictional house is in `tests/rbac_fixtures.py`: Cody is a child with Cody's Room, Gwen is a
guest with the Guest Room, and the loft tablet's room is the Loft. All requests below are on the LAN
with no fresh factor unless the row says otherwise.

| Subject | Request | Decision |
|---|---|---|
| Adult | `light.turn_on` light.kitchen | allowed |
| Adult | `lock.unlock` lock.front_door | needs_step_up (`step_up_required`) |
| Adult, PIN 60 s ago | `lock.unlock` lock.front_door | allowed |
| Adult, PIN 301 s ago | `lock.unlock` lock.front_door | needs_step_up |
| Adult | `configure` vacuum.downstairs | denied (`no_grant`) |
| Owner | `homeassistant.toggle` lock.front_door | needs_step_up (classified `lock`) |
| Child | `media_player.turn_on` media_player.cody_tv | allowed |
| Child | `light.turn_on` light.kitchen | denied (`no_grant`) |
| Child | `lock.lock` lock.front_door | denied (`explicit_deny`) |
| Child + "no TV 21:00 to 06:00" grant, 23:30 | `media_player.turn_on` | denied; `view` still allowed |
| Guest | `view` person.jamie | denied (`explicit_deny`) |
| Guest after `guest_until` | anything | denied (`explicit_deny`) |
| Loft tablet alone | `light.turn_on` light.loft | allowed |
| Loft tablet alone | `lock.unlock` lock.balcony | needs_step_up (`person_pin_required`) |
| Owner at loft tablet, fresh PIN | `lock.unlock` lock.balcony | allowed |
| Owner at loft tablet | `light.turn_on` light.kitchen | denied, side `device` |
| Child at loft tablet, fresh PIN | `lock.unlock` lock.balcony | denied (`explicit_deny`), no prompt |
| Loft tablet on the tunnel | anything | denied (`device_on_tunnel`) |
| Adult on the tunnel, fresh PIN | `lock.unlock` | allowed |
| Guest with a lock grant, on the tunnel | `lock.unlock` | denied (`tunnel_lan_only`) |
| Role with view+history but no tunnel switches, on the tunnel | `view` camera / `history` person | `tunnel_cameras_off` / `tunnel_locations_off`; `view` person (home/away) allowed |
| Admin | `configure` feature `owners` | denied (`explicit_deny`) |

## The read filter

- `Policy.visible(subject, entity_id, ctx)` is simply `decide(..., "view", ...)`.
- `Policy.redact(subject, entity_id, state, ctx)` handles person/device_tracker GPS (`latitude`,
  `longitude`, `gps_accuracy`, `altitude`, `course`, `speed`, `vertical_accuracy`). Those
  attributes are removed unless the subject may read that entity's `history`, which also brings the
  §7 tunnel locations switch into play. When nothing is removed, the same object comes back.
- `rbac.Gate(policy_or_callable, subject, context_factory)` binds one session.
  `ClientView(store, registry, coalescing, gate=gate)` then:
  - selects only visible entities, whether asked for by id, by area, or with `all`. New entities
    appearing upstream are gated too.
  - passes every snapshot and diff state through `redact`. Diffs compare redacted against redacted,
    so a GPS-only move sends nothing to a session that can't see GPS.
  - reports an entity asked for by id but not visible as `missing`, the same as one that doesn't exist.
  - re-resolves on `policy_changed()` and re-checks everything it has sent. Call it after a grant
    edit (the REST does) and on a timer so schedules apply (a guest's window closing empties the view).
- `filter_registry(shapes, gate)` cuts `Registry.frontend_shapes()` down to the visible entities, the
  devices that have one, and the areas and floors they use.
- With no gate, `ClientView` behaves exactly as before. All existing tests and the smoke pass unchanged.

**Deliberate reading of §5 on locations.** PLAN lists person/device_tracker locations as sensitive.
A live state stream can't stop to ask for a PIN, so location reads aren't step-up gated. They are
gated by the `history` action (Guest: explicit deny; Child: no grant) and by the tunnel `locations`
switch. Requests to the history and logbook proxies for these entities go through the same check.

## Storage and REST

`migrations/0002_rbac.sql` follows the numbered-file convention and contains no transaction
statements (the runner owns those). It is idempotent. `rbac_store.ensure_schema(conn)` applies it
to a bare connection.

`RbacStore(conn)`:
- grants: `grants()`, `add_grant(grant, by)`, `remove_grant(id)`
- role overrides: `overrides()`, `check_override(role, body)`, `set_override(role, body, by)`,
  `clear_override(role)`
- scopes: `scopes(kind, id)`, `set_scopes(kind, id, areas)`
- `policy()` is cached and invalidated on every write through the store
- `subject(...)` builds a Subject with its areas filled in from the scopes

Unreadable rows never widen access. An unreadable allow is dropped, an unreadable deny becomes a
deny of everything for its targets, and an unreadable override leaves that role with no grants.

`register(app, hub, *, identity, store=None, conn=None, csrf=None, audit=None)`:
- `identity(request)` may be sync or async. It returns None or `{"user_id", "role"}`. Anything
  other than `role == "owner"` gets 403, and no identity gets 401.
- `csrf(request)` must pass for every change. Use P3.1's check.
- `audit(event)` runs before a change is applied. If it raises, the change is refused with 503.

The routes, all Owner-only:
- `GET`/`POST /api/rbac/grants`
- `DELETE /api/rbac/grants/{id}`
- `GET /api/rbac/roles`
- `PUT`/`DELETE /api/rbac/roles/{role}`
- `GET`/`PUT /api/rbac/scopes/{user|device}/{id}`

After each change, every session in `hub.sessions` runs `view.policy_changed()` and is woken.

## Tests

`~/.venvs/mantel/bin/python -m pytest -q`: **945 passed** (217 before this slice; 728 new).
- `test_rbac.py` (693):
  - the role matrix: 7 subjects × 38 (action, entity) cases covering every domain and the sensitive
    set, run both with and without a fresh factor
  - reasons, classification (29 cases), deny precedence, overrides, intersection (including the
    person-at-the-tablet cases), step-up freshness boundaries
  - tunnel rules for every role
  - schedules: midnight crossing, days, time zones, DST, guest time-box, absolute windows, validation
  - area and floor resolution through the registry (by id, name, device, glob, domains filter,
    garage device_class from the registry or the state)
  - feature requests, grant validation and round-trips, and the engine side of the read filter
- `test_rbac_filter.py` (12): a Child session never receives a lock (by `all`, by id, by area, or
  newly appearing); a Guest never receives person or tracker locations; GPS redaction holds through
  diffs; tunnel sessions; grant and schedule changes; registry filtering; no gate means unchanged behaviour.
- `test_rbac_store.py` (23): migration convention and idempotence, round-trips, scopes, overrides,
  unreadable rows; the REST is Owner-only on every route (401/403), add/list/remove, bad input
  (400), CSRF (403), audit failure (503, no change), and a grant change reaching a connected session at once.

`tools/headless/client_smoke.py` passes. Its Chrome uses the fixed port 9337, so it fails at random
if another worktree runs the smoke at the same moment. Run it alone.

## Not done here (open questions for Avery)

- **Camera live view and step-up.** §5 lists camera live view as sensitive, so by default it needs a
  fresh factor, and on a wall tablet a person's PIN. That clashes with today's doorbell popup on the
  tablets. `Policy.step_up_exempt={"camera"}` turns it off house-wide. Avery decides at P3.7.
- **"Opt-in for other roles" on the tunnel** is read as: on for Owner and Admin (they include
  everything an Adult has), off for Child, Guest, Service and any new role.
- **A wall tablet's scope** is its room's areas plus entity grants. Working it out from the room's
  dashboard config is later work (P3.5 settings).
- **Services with no entity** (`notify.*`, music) should be decided with `feature=` (`notifications`,
  `music`). The gateway passes service names, never a bare `control`, because a bare `control` is
  never reclassified as sensitive.

## Exact continuation point

1. **P3.7 wiring in `server.py`.** No edits were made to it here.
   - `rbac = rbac_store.register(app, hub, identity=<P3.1 session resolver>, conn=<db.py connection>, csrf=<P3.1 check>, audit=<P3.3 audit>)`
   - In `ClientSession.__init__`: `gate = rbac.Gate(rbac.policy, rbac.subject(...from the session...), lambda: rbac.Context.from_registry(hub.registry, time.time(), house_tz, hub.store.states))`, then pass `ClientView(..., gate=gate)`
   - `api_registry` returns `filter_registry(shapes, gate)`
   - A once-a-minute task calls `s.view.policy_changed(); s.wake.set()` for every session (schedules,
     guest windows)
   - `house_tz` comes from HA's `get_config` `time_zone` (or a config key)
   - Add `"migrations/*.sql"` to `[tool.setuptools.package-data]` once P3.1 lands the migrations package
2. **P3.3 gateway.** Call `policy.decide(subject, "<domain>.<service>", entity_id, ctx)` for each
   target entity, plus `feature=` for entity-less services. On `needs_step_up`, prompt (PIN or
   passkey; for `person_pin_required`, a person's PIN at the tablet), then decide again with
   `fresh_factor_at` (and the person as the user). Audit every control and every denial.
3. **P3.4 read proxies.** Filter `entity_ids` in history, logbook and statistics with
   `decide(..., "history", eid)`. Camera signaling uses `decide(..., "camera.live", eid)`.
