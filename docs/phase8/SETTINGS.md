# Mantel Settings: HK Settings and Mantel's settings, one page (decision 27, 2026-10-19)

Mantel had two settings pages: Mantel settings (`/admin`: people, devices, connections, service accounts, your
files, roles, Connect, audit) and HK Settings in Mantel (`/hk-settings`: screens, pages, the Alarm PIN, energy,
music ...), linked to each other. Avery asked for one. HK Frontend installed on its own (in Home Assistant, from
HACS or from Mantel's installer) must show HK Settings only and never anything of Mantel's. This is PLAN.md Phase
8's "Mantel admin folded into HK Settings", done ahead of the cutover.

## What it is

**Mantel Settings, `<base>/settings`**: HK Settings' own panel (`web/hk/panels/hk-settings.js`, HK's settings kit:
iOS Settings, per docs/DESIGN.md "HK Settings stays iOS Settings"), named Mantel Settings, with Mantel's own pages
in it, drawn with the same kit:

| Sidebar | Who sees it |
|---|---|
| The person's own row at the top (their name: Me — account, sessions, passkeys, two-step sign-in, an optional PIN, sign out) | everyone signed in |
| Overview, Screens, Pages, All Screens, Library, System (HK's) | Owner, Admin (`house`) |
| People & Access: People, Devices, Roles & Grants, Service Accounts, Audit Log | by `admin_page.sections_for` (Owner: all; Admin: no Roles or Service Accounts) |
| Mantel: Connections (HA, MA, the MA page token, HTTPS and your proxy), Mantel Connect (when on), Your Files | by `sections_for` |

The rules are the server's, as before: the page shows what `GET /api/admin/overview` lists, and every route still
refuses on its own. A wall tablet gets the refusal page. Adult, Child and Guest get Me only, and HK's settings are
never read for them. Before Home Assistant is connected (the first run) the page opens on Connections with
Mantel's pages only, and reloads into the full page once HA is saved.

## Addresses

| Old | Now |
|---|---|
| `/hk-settings#/screens/...` (HK's links, the energy sheet's "More energy settings") | 302 → `/settings`; the browser keeps the fragment |
| `/admin`, `/admin#connections` (a person, not at a tablet) | 302 → `/settings`; `#connections`, `#people`, ... forward to `#/mantel/<section>` |
| `/admin?connection=<id>` (HA's sign-in coming back) | `/settings?connection=<id>`; new returns go to `/settings?connection=<id>#/mantel/connections` |
| `/admin?plain=1` | the old admin page, kept as the fallback (Mantel Settings' load error links to it) until Phase 7 |

The Ingress prefix is kept on every redirect (`ingress.py` moves `Location`). The menu (side menu and the tab bar's
More sheet) has one row, **Mantel Settings**, for every person and none for a wall tablet. HA's sidebar entry still
opens the dashboard.

## How the shared panel knows its host

A new host-shell capability, `hkShell.settingsHost()` (`web/client/hk-host-shell.js`): `null` by default, and Home
Assistant's shell (`hosts/ha/frontend/hk-ha-shell.js`) never sets it. The panel knows only a generic shape
(documented at the top of `hk-settings.js`): a title, `house`, sidebar groups (`top` / `end`), `page(parts)` for
the addresses the host owns, `forward(path)`, `first()`, `search()`, `notes` (the host's words where HK's pages
differ: the Overview's footer, Add Screen, removing a screen) and `screenBase`, `back`. The menu's and tab bar's
host section (it said "Mantel" in HK's own code, hidden in HA) now takes its name from the host's menu entry. Mantel's answer is
`web/shim/mantel-settings.js`, handed over by `web/shim/settings-page.js` through `hkMantelShell.setSettings`.
`web/shim` is never in the HA build (`publish.py`'s plan), and the two Mantel footers and `window.__mantelBase`
left the shared panel, so the panel HA ships has no Mantel tab, link, request or word.

## Mobile

Before: a screen's live preview showed only at ≥1,320 px beside the page, and at 860–1,320 px on the screen's own
page; a phone had none. Now a phone shows it on the screen's own page too (under the title), and on every page
with a preview, narrower than a desk, an eye button in the bar **pins** it to the top of the page (sticky, its
size picker kept, sized to about a quarter of the window): the settings scroll under it. Remembered in the browser
(`localStorage` `hk-preview-pinned`). Shared code: HK in HA gets the same button.

## Tests

* `hosts/ha/.../tests/test_settingshost.js` (41): HA's shell answers no host; the panel then has HK's groups only,
  its own name, no host words, no host pages; a generic host's groups, pages, forwards, words and search; the host's
  pages only (`house: false`) read nothing of HK's; the Preview button.
* `tests/test_mantel_settings.py`: Mantel's host per role (Owner, Admin, Adult, first run), forwards, glyphs in the
  served MDI subset, and the HA build: no Mantel file, no "mantel" in the panels it ships, no `settingsHost` in
  HA's shell.
* `tests/test_ingress_own_pages.py`, `test_admin_page.py`, `test_ingress_tablets.py`: `/settings` for every
  person, refused to a tablet, the redirects (plain and Ingress), `/admin?plain=1`.
* `hosts/ha/.../tests/test_menu.js`: the menu's and tab bar's host section is named by the host
  (`hkShell.hostMenu()[0].section`, "Mantel" from Mantel's shell); HA has none, so no section and no word.
* `tests/test_mantel_settings.py` also: nothing the HA build ships says "Mantel" outside a developer's comment.
* `tools/headless/client_smoke.py`: the More row and its "Mantel" heading, the page, Mantel's groups, the way back.
* `tools/testha/check.py` 6c: the scratch HA's HK Settings, on its own pages, Mantel's addresses and `/admin`'s old
  ones: no Mantel tab, link, request, websocket message or word; `settingsHost()` null, no host menu.
* Browser pane, 2026-10-19: a local Mantel against the scratch HA (Owner and Adult, desktop and phone width,
  every Mantel page, the pinned preview) and the scratch HA's own HK Settings (no Mantel text on any page, old
  Mantel addresses open Overview, no Mantel requests, `settingsHost()` null).

## Not done here

* The App is not updated; nothing is installed on the house.
* Devices (Mantel's enrolled tablets) and All Screens → Wall Tablets (HK's tablet behaviour) are still two pages,
  cross-referenced. Merging them is a later step.
* Each session and passkey is a row with its own Revoke/Remove button below the list, not a detail page per item.
