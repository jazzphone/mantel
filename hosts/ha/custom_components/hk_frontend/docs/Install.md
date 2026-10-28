# Install

Install HK Frontend from HACS and add the integration. It takes about five
minutes; then [Your First Screen](Your-First-Screen.md) makes a screen from
your rooms and devices.

Want the same screens with people and roles, wall tablets that sign
themselves in and an audit log, on a server of their own? That is
[Mantel](https://github.com/jazzphone/mantel/wiki/Install), HK Frontend's
sibling; the two can run together: [HK Frontend and Mantel](HK-Frontend-and-Mantel.md).

## Before you start

You need:

- **Home Assistant 2026.8 or newer**, any installation type.
- **[HACS](https://hacs.xyz)**, installed and set up.
- An admin account. HK Settings is for admins only.
- **Your devices assigned to areas.** Generated screens, room pages and the menu are built from your areas. A device with no area still shows up, but in a section called **More** instead of in a room, and on no room page. You can fix this at any time, and the screen follows.

It also helps to have given each area an icon and, under the area’s *Related sensors*, a temperature and a humidity sensor. The menu shows the icon, and a room page’s status line shows the readings.

Optional, for the features that use them:

| For | You need |
|---|---|
| [Music](Music.md) | [Music Assistant](https://www.music-assistant.io) and its Home Assistant integration |
| [Live TV](Live-TV.md) | An HDHomeRun tuner, and ffmpeg on the Home Assistant host (Home Assistant OS and Container already include it) |
| [Clean Areas](Clean-Areas.md) | Vacuums with room maps in Home Assistant |
| [Wall tablets](Wall-Tablets.md) | [Fully Kiosk Browser](https://www.fully-kiosk.com) on the tablets (the photo screensaver and hiding Home Assistant’s header are built in) |
| A radar map on the Weather page | Internet access; enable HK’s built-in radar in **HK Settings → Pages → Weather → Radar Map** (no HACS radar card or API key needed) |

## Install with HACS

HK Frontend is installed as a custom repository in HACS.

1. Open **HACS**, then **⋮** (top right) → **Custom repositories**.
2. In **Repository**, enter `https://github.com/jazzphone/hk-frontend`.
3. In **Type**, choose **Integration**, then select **Add**. Close the dialog.
4. Search HACS for **HK Frontend**, open it and select **Download**. Confirm the download.
5. Restart Home Assistant: **Settings** → **System** → **⋮** → **Restart Home Assistant** (or use the *Restart required* entry HACS adds to **Settings** → **Repairs**).

## Add the integration

1. Go to **Settings** → **Devices & services** and select **Add integration**.
2. Search for **HK Frontend** and select it.
3. The dialog explains what HK Frontend adds and asks nothing. Select **Submit**.

You should now see **HK Settings** in the sidebar (admins only).

Adding the integration also loads its theme, which gives the screens their colors, font and glass look: **HK Kiosk**, and **HK Kiosk Camera**, a variant for picture cards. You’ll find both under **Theme** in your profile, but you don’t need to pick one: a generated screen uses HK Kiosk by itself.

HK Frontend is set up once per Home Assistant, and there is nothing to add to `configuration.yaml`.

## The card resources

HK Frontend’s cards are dashboard resources: 18 JavaScript modules under `/hk/cards/` and two stylesheets (`/hk/fonts/sf-pro.css` and `/hk/css/hk-responsive.css`).

**Most homes: nothing to do.** With dashboard resources in storage mode (the default), HK Frontend adds any that are missing once Home Assistant has started. It only ever adds: it never edits, reorders or removes a resource, and a resource you already added with a `?v=` on the end counts as present. You can see them under **Settings** → **Dashboards** → **⋮** → **Resources** (visible with *Advanced mode* turned on in your profile).

**Resources in YAML mode.** If your `configuration.yaml` has `lovelace: resource_mode: yaml`, HK Frontend can’t add to your list. Add them yourself:

```yaml
lovelace:
  resource_mode: yaml
  resources:
    - url: /hk/fonts/sf-pro.css
      type: css
    - url: /hk/css/hk-responsive.css
      type: css
    - url: /hk/cards/hk-base.js
      type: module
    - url: /hk/cards/hk-cameras.js
      type: module
    - url: /hk/cards/hk-chip.js
      type: module
    - url: /hk/cards/hk-control.js
      type: module
    - url: /hk/cards/hk-detail.js
      type: module
    - url: /hk/cards/hk-energy.js
      type: module
    - url: /hk/cards/hk-home.js
      type: module
    - url: /hk/cards/hk-layout.js
      type: module
    - url: /hk/cards/hk-library.js
      type: module
    - url: /hk/cards/hk-media.js
      type: module
    - url: /hk/cards/hk-popup.js
      type: module
    - url: /hk/cards/hk-room.js
      type: module
    - url: /hk/cards/hk-row.js
      type: module
    - url: /hk/cards/hk-security.js
      type: module
    - url: /hk/cards/hk-stat.js
      type: module
    - url: /hk/cards/hk-strategy.js
      type: module
    - url: /hk/cards/hk-tile.js
      type: module
    - url: /hk/cards/hk-weather.js
      type: module
```

A later version may add a card file. **Setup Check** (step 6) always lists exactly the ones you are missing.

## Removing HK Frontend

1. **Settings** → **Devices & services** → **HK Frontend**, then the **HK Frontend** entry’s **⋮** → **Delete**. Its features, items and Repairs entries go with it.
2. In **HACS**, open **HK Frontend** → **⋮** → **Remove**, then restart Home Assistant.
3. Remove what HK Frontend left for you to own: the screens it created (**Settings** → **Dashboards**), its resources (**Settings** → **Dashboards** → **⋮** → **Resources**, every URL starting with `/hk/`), and your files folder. The HK Kiosk themes go with the integration.
