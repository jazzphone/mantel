# Strategies and Grid View

The view type HK Frontend’s pages use, and the two strategies that build a
whole screen or a room page from your home.

## The view: `custom:hk-grid-view`

HK Frontend’s screens use their own view type, a CSS grid that places each
card by its `view_layout`. Use it for your own views, with the live sky:

| Key | What it does |
|---|---|
| `type: custom:hk-grid-view` | The view type. |
| `layout` | As for `hk-grid-card`. HK Frontend’s pages use a three-column grid with every card in the middle column (`view_layout: {grid-column: "2"}`). The side columns are `--hk-side` of the page’s width: 1.5% from 641 px up, 2% on a phone and in the car (below). |
| `sky: true` | The live sky behind this view (the dashboard also needs a `sky:` block; see [The live sky](Live-Sky.md)). |
| `sky_variant` | A still color wash instead: `lights`, `climate`, `doors`, `timers`, `vacuums`, `water`, `cameras`, `playmusic`, `energy` or `power`. |
| `theme: HK Kiosk` | HK Frontend’s theme, for this view. |

The side margins, as generated pages write them:

```yaml
layout:
  grid-template-columns: calc(var(--hk-side, 0.02) * 100%) calc(100% - 2 * var(--hk-side, 0.02) * 100%) calc(var(--hk-side, 0.02) * 100%)
```

`--hk-side` comes from `hk-responsive.css`, a resource HK Frontend adds for
you. With a fixed `2% 96% 2%` the grid is narrower: a 1280 px wall tablet
fits five 196 px pills across instead of six.

The menu reads a few more view keys (`area`, `menu`, `menu_title`,
`menu_icon`); see [The menu on your own dashboard](Menu.md#the-menu-on-your-own-dashboard).

## The strategies

### `custom:hk-dashboard`

A whole generated dashboard, built from your floors, areas and devices every
time it opens. A dashboard made in HK Settings is this strategy. In a
dashboard’s raw configuration editor:

```yaml
strategy:
  type: custom:hk-dashboard
```

Its settings come from HK Settings (the screen’s own, and **Accessories →
Hidden Accessories** and **Added Accessories**). A few options can also be written
here; lists add to HK Settings’ lists:

| Option | What it does |
|---|---|
| `areas` | Only these areas, in this order. |
| `exclude_areas`, `exclude_devices`, `exclude_entities` | Leave these out. |
| `include_entities` | Show these too, in their room (or under More). |
| `theme` | A theme for every view. |
| `sky: false` | No live sky. |
| `music: false` | No music pages, even with Music added. |
| `chips: false`, `pages: false`, `rooms: false` | No status chips, no category pages, no room pages. |

### `custom:hk-room`

A room page built from an area, for a dashboard you write yourself. It is
built again each time it opens, so a new device appears by itself.

```yaml
- title: Kitchen
  path: room-kitchen
  subview: true
  sky: true
  strategy:
    type: custom:hk-room
    area: kitchen
```

| Option | What it does |
|---|---|
| `area` (required) | The area, or a list of areas for a room that spans several (`[backyard, deck]`). |
| `name` | The page’s title. Default: the area’s name. |
| `theme` | The view’s theme. |
| `exclude_entities`, `exclude_devices`, `include_entities` | Leave things out, or add them. |

The menu lists it as a room, and an `hk-heading-card` with the same `area`
links to it.

---
