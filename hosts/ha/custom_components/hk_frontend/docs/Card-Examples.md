# Card Examples

Complete YAML for a Home view, a pop-up, and a chip of your own, using the
[Card Library](Card-Library.md).

## A Home view by hand

A header, the status chips, and one room with its tiles, on the live sky:

```yaml
sky: {}
views:
  - title: Home
    path: home
    type: custom:hk-grid-view
    theme: HK Kiosk
    sky: true
    layout:
      grid-template-columns: calc(var(--hk-side, 0.02) * 100%) calc(100% - 2 * var(--hk-side, 0.02) * 100%) calc(var(--hk-side, 0.02) * 100%)
      margin: 0px
      padding: 0px
    cards:
      - type: custom:hk-header-card
        weather_path: ./weather
        alarm_path: ./security
        view_layout:
          grid-column: "2"
      - type: custom:hk-chips-card
        view_layout:
          grid-column: "2"
      - type: custom:hk-heading-card
        name: Kitchen
        area: kitchen
        view_layout:
          grid-column: "2"
      - type: custom:hk-grid-card
        view_layout:
          grid-column: "2"
        layout:
          grid-template-columns: repeat(auto-fill, var(--hk-track, 196px))
          grid-auto-rows: 80px
          grid-auto-flow: dense
          grid-column-gap: 10px
        cards:
          - type: custom:hk-light-card
            entity: light.kitchen_lights
            icon: hk:ceiling-light
            icon_tap_action:
              action: toggle
          - type: custom:hk-tall-card
            entity: lock.back_door
            icon: hk:lock
            icon_states:
              unlocked: hk:lock-open-variant
            label_mode: state
            view_layout:
              grid-row: span 2
          - type: custom:hk-cover-card
            entity: cover.kitchen_blinds
            icon: hk:blinds-horizontal
            icon_tap_action:
              action: toggle
          - type: custom:hk-media-card
            entity: media_player.kitchen
            icon: hk:homepod
  - title: Kitchen
    path: room-kitchen
    subview: true
    sky: true
    strategy:
      type: custom:hk-room
      area: kitchen
```

## A pop-up and a tile that opens it

```yaml
- type: custom:hk-scene-card
  name: Garage
  icon: hk:garage
  tap_action:
    action: navigate
    navigation_path: "#garage"
- type: custom:hk-popup-card
  hash: "#garage"
  width: 460px
  auto_close: 60000
  cards:
    - type: custom:hk-heading-card
      name: Garage
    - type: custom:hk-doorbell-card
      entity: camera.garage
      name: Garage
    - type: custom:hk-cover-card
      entity: cover.garage_door
```

Put both on the same view. An automation or a link can open the pop-up too,
with that view’s address and `#garage` on the end.

## A chip of your own

A chip that says how many windows are open, shown only while one is:

```yaml
type: custom:hk-status-chip-card
name: Windows
icon: hk:window-open-variant
quiet: true
active:
  - above: 0
count:
  entities:
    - binary_sensor.kitchen_window
    - binary_sensor.living_room_window
  match: "on"
zero: Closed
format: "{v} Open"
tap_action:
  action: navigate
  navigation_path: ./doors-windows
```

For a chip on every generated screen, add it under **HK Settings → Library →
Custom Chips** instead.
