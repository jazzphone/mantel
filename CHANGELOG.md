# Changelog

All notable changes to Mantel are listed here. Versions follow [semantic versioning](https://semver.org); the Home Assistant App, the Docker images and the Python package share one version number.

## 0.1.59 - 2026-10-23

Local Home Assistant App update for the house.

- Home Grid's searchable card picker shows live previews and available sizes, with options and conditional fallback previews.
- Room and scene groups have surrounding tiles, fuller scene rows and clearer page dots. Each group supports background color, opacity and blur.
- Music artwork and track information align, with more space around the progress bar. Weather, camera, security and timer cards have updated layouts and controls.
- The picker and settings scroll independently while the dashboard preview and editor toolbar stay visible, including on shorter screens.

## Unreleased

The first public release.

- **Home Grid follow-up:** camera selections stay on one camera; screen settings collapse, with independent header clock/weather switches. Room groups use taller filling tiles, thermostats share the card plate, and centred page dots have a pill. Picker icons and illustrative data are complete. Larger weather cards show more readings and forecast detail, with an optional Sky weather background.

- **Home Grid editor (in development)**: desktop draft editing with drag and snap, equal-size swaps, keyboard moves, card options, pages, starter layouts and Save/Cancel. Mantel adds layout history and copying to another screen. The compact header, clock and thermostat layouts are refined, and swipe-page cards align with their neighbors. Review refinements add a searchable gallery with live previews, framed room and scene groups, a forecast widget, single-camera selection, security and timer controls, conditional blocks with fixed-size fallbacks, and consistent glass plates. Room and scene groups support individual background color, opacity and blur; scene pills fill their framed rows and music artwork aligns with track information.

- **Mantel Server**: serves HK Frontend's screens without Lovelace, from your Home Assistant's rooms and devices.
- **People and roles**: Mantel accounts with passwords, passkeys and authenticator codes, or sign-in with Home Assistant; Owner, Admin, Adult, Child and Guest roles, with grants per room and feature.
- **Wall tablets**: a browser enrolled as a tablet keeps its own credential and role, whoever is signed in.
- **Commands and audit**: commands are off until the operator turns them on; each one is checked against the person's and the device's role and written to the audit log before it is sent.
- **Music Assistant and cameras** through Mantel, **Mantel Photos** for the screensaver, and **backups**.
- **Mantel Link**: the Home Assistant integration that links Home Assistant to Mantel.
- **Three ways to run it**: the Home Assistant App, Docker Compose, or a Proxmox LXC.
- **Set Up Mantel**: a first-run checklist in Mantel Settings, each step worked out from the house (Home Assistant, screens, the household, the Owner's sign-in, the Alarm PIN, house commands) and opening the page that does it.
- **One step for a new wall tablet**: enrolling into a room with no HK tablet adds that HK tablet too.
- Importing HK's settings from a Home Assistant without HK Frontend says there is nothing to import; Setup Check says how house commands are turned on where Mantel runs.
- **Mantel Settings, each thing in one place**:
  - A wall tablet is one page (All Screens, Wall Tablets): its screen and kiosk app, and now the browser signed in to Mantel as it, its Home Assistant user and Sign Out. The separate Devices page is gone, and so is HK's Tablet User there.
  - Connections → Home Assistant has what Home Assistant has of Mantel: Mantel Link (a pairing code), HK Frontend (its credential, made right there) and the sidebar (Mantel Connect). Who runs each tablet and the bridge are under Moving from HK Frontend. Connections → Music Assistant has the Browse Music page's sign-in.
  - Service Accounts is under Advanced, and says which credentials Mantel made and what uses them.
  - Revoked tablets, Service accounts and Connect pairings leave their lists after 30 days, or at once with Clear List; the Audit Log keeps them. The Home Assistant App no longer leaves a revoked "App discovery" credential behind at every restart, and makes none when Mantel Link was set up by hand.
  - People: the Home Assistant user picker offers each person once and never a Wall Tablet account. Home Assistant users linked to Wall Tablet accounts (from before tablets were enrolled) move to their tablets in one step, and the accounts go.
  - Audit Log: From and To say Any Time, Now or the last hour, day, week or month, with a date only when you choose one.

- **Doorbell talk is live through Mantel again**: Mantel connects to Home Assistant for the doorbell while the tablet opens its own connection, and the card waits up to 4 s for the doorbell to listen (1.5 s was too short for Mantel's extra steps, so every press fell back to a recorded message). How long each press waited is in Mantel's log.

- **Keep in View for Mantel Photos**: Mantel finds where the faces are in each photo (only where, never who; on the server, nothing leaves the house), and the Photo and Mosaic screensavers crop and zoom around them. Photos already in Mantel are checked in the background. An Owner or Admin can set what stays in view by hand from a photo's preview (Keep in View), or put it back to Automatic. The Mosaic also picks layouts that fit the photos' shapes. Adds onnxruntime and numpy (about 140 MB installed).

- **Page health in Mantel's log**: each screen's page says how the page before it ended and how big it is each minute, to find why wall tablets reload every 15 minutes.

- **The House, when it matters**: with no HK Frontend in Home Assistant, Mantel takes the house by itself (Live TV through Mantel Link needed it switched on). While HK Frontend is still there, Set Up Mantel lists Move the House to Mantel, and Connections → Home Assistant says when it's time.

- **My Sessions, one row per browser**: every launch of the Mantel app left a 30-day "Browser on iPhone" session behind. The app's pages now keep one session, listed with the app under Mantel App, and signing the app out ends it.

### Fixed before release (engineering audit, October 2026)

Security:
- Changing the Alarm PIN from HK Settings needs a recent sign-in, as its other routes did.
- Room changes in Home Assistant, and rooms given to a person, apply at once to what each person and tablet may see and do.
- A Home Assistant sidebar connection is checked again like any session: a disabled or demoted person loses it.
- The Music Assistant page is signed in only for someone who may play every speaker, with house commands on.
- Mantel Link never sends its credential to an address a network announcement names.
- Live camera and Live TV streams end when the right to watch them ends; a camera hidden from someone can't be watched by its id.
- Entities named inside a command's data (joined speakers, a camera cast to a TV) are checked like its target; a wall tablet may watch cameras and talk at the door, not turn cameras off or record them.
- Sign-in: a right password no longer resets the count of wrong authenticator codes; adding an authenticator or passkey needs a recent sign-in; replacing an authenticator keeps the old one working until the new one is confirmed; Confirm It Is You accepts only your own passkey.
- Visitors through the Cloudflare tunnel are each their own address (one person's wrong passwords no longer slow everyone's sign-in from away).
- HK Frontend: the artwork proxy fetches only Music Assistant's image proxy on the home network, whatever `..` a link carries; five wrong PINs lock an Alarm PIN panel for 15 minutes.

Reliability:
- Screens follow the house again after the connection to Mantel drops.
- Screens and tablets follow All Screens' and All Tablets' settings (menu, tab bar, screensaver, Return to Home When Idle).
- Category notifications (doors, leaks, smoke) work right after Mantel starts.
- Docker and LXC: browser notifications and pairing the iPhone, iPad and Mac apps work (their keys live in the data folder, and in backups).
- Backups: a backup made by hand deletes no older ones; a database-only restore keeps your photos; leftovers of an interrupted backup are cleaned up.
- Push notifications survive an internet outage, and stop at an app that was signed out.
