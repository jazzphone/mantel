# Mantel Photos: the screensavers' own photo library (2026-10-19)

HK's Photo Screensaver shows the pictures in a Home Assistant media folder (All Screens → Screensaver →
Screensaver Photos, `media-source://media_source/local/photos`). On Mantel those photos stopped loading: the
screensaver resolves each one with `media_source/resolve_media`, and HA's answer is a signed address on HA's
own origin that a Mantel page can't load. The quick fix (main, `connectors/media_photos.py`) answers that read
in Mantel. This is the longer-term answer Avery asked for: *"move all of this to Mantel with a way to upload
photos into bulk, and even have a list/preview/way to delete them"*. Confirmed: bulk upload, a grid with a
preview, delete, albums, and an import from Home Assistant.

Built and tested offline and against a local Mantel with fictional photos. **Not on the house.** Nothing changes
in HK Frontend inside Home Assistant.

## What it is

| Part | Where |
|---|---|
| Storage, processing, REST, the HA import | `hosts/server/mantel_server/photos.py` |
| The records | migration `0018_photos.sql`: `photo_albums`, `photos`, `photo_screens`, `photo_settings` |
| Mantel Settings → Photos | `web/shim/mantel-photos.js` (wired in `mantel-settings.js`; Owner and Admin) |
| The screensaver's side | `web/hk/modules/hk-saver.js` asks the host (`hkShell.photoSource` / `listPhotos`, `web/client/hk-host-shell.js`); Mantel's answers are in `web/shim/mantel-shell.js` |
| The pickers on HK's pages | `web/hk/panels/hk-settings.js` calls the host's `extend('saver', …)` (a screen's Screensaver Options) and `extend('house-saver', …)` (All Screens → Screensaver) |
| Backups | `backup.py` packs and restores `<data_dir>/photos` with "Your files" |
| Dependencies | `pillow-heif` is now a dependency (HEIC); `Pillow` and `pillow_heif` are pinned in `packaging/ha-app/requirements.txt` (the App image had no Pillow before) |

### Albums and sources

An album is a named set of photos; each photo is in exactly one album. A screensaver's source is either a Home
Assistant media folder (`media-source://…`, as before), HK's landscapes (Behind the Clock: Landscapes, as
before), or an album, named `mantel-photos://<album id>`.

* **A screen's own album.** Its Screensaver Options page gets a Photos group: *Show: Screensaver Photos (All
  Screens) / an album*. Mantel keeps that choice (`photo_screens`), not HK's settings, so HK's settings model and
  Home Assistant's copy never see it. Deleting the album takes the screen back to the house's photos.
* **Every screen's album.** All Screens → Screensaver gets *Mantel Photos Album* under Screensaver Photos. It
  writes `mantel-photos://<id>` into `look.photos` (Mantel's copy of HK's settings only); choosing the Home
  Assistant folder again writes `media-source://media_source/local/photos`.

### How the saver gets an album (additive)

`hk-saver.js` asks its host two things, both `null` in Home Assistant (so nothing changes there):

1. `hkShell.photoSource(source)` in `refresh()`: a source for this page's screen in place of the house's.
   Mantel's shell reads `GET /api/photos/screens` once, again every 5 minutes, and at once when Mantel Settings
   changes something in the same browser (a `localStorage` signal; the screen previews in Settings follow it).
2. `hkShell.listPhotos(source)` in `listPhotos()`: for a source the host serves itself, a promise of
   `[{id, title, url}]`. Mantel answers for `mantel-photos://<id>` with `GET /api/photos/albums/<id>/show` and
   puts the page's prefix in front of each screen-sized photo's address. The saver then loads each by its
   address, as it does a landscape: no `resolve_media` at all.

The HA-folder path (browse, then resolve, now answered by Mantel's quick fix) is untouched beside it.
`hkSaver.photosChanged()` drops the listed deck and asks the source again. An album's new photos reach a
tablet at its next listing (the saver re-lists every 30 minutes).

### Storage and processing

`<data_dir>/photos/{originals,screen,thumbs}/<photo id>.{jpg,webp}`, folders 0700, files 0600, outside the web
root. Every upload is checked by its bytes (never its name or the browser's type): JPEG, PNG, WebP, HEIC/HEIF.
It is decoded and re-encoded:

* the orientation applied, then **every bit of metadata dropped** (EXIF, GPS location, camera, XMP); wide-gamut
  colour to sRGB; transparency flattened onto black;
* **original**: full size up to 8192 px on the long side, JPEG q90 (a re-encode, so no location survives; the
  uploaded bytes are not kept);
* **screen**: 2560 px, JPEG q85 (what the screensavers show);
* **thumbnail**: 480 px, WebP (the grid).

The SHA-256 of the bytes as they came in is kept: the same picture twice in one album is skipped
(`duplicate: true`), also when two uploads of it race.

### Limits (a setting)

| Limit | Default | Range | Who changes it |
|---|---|---|---|
| One upload (`file_mb`) | 40 MB | 1-200 MB | Owner |
| All photos, every stored size (`quota_mb`) | 4 GB | 100 MB-1 TB | Owner |
| Pixels | 100 megapixels | fixed | |
| Albums / photos per album | 200 / 20,000 | fixed | |

Settings → Photos → Storage shows the space used against the limit.

### Who may do what

| | Owner | Admin | Adult, Child (feature:media) | Wall tablet | Guest |
|---|---|---|---|---|---|
| See the page, albums, upload, delete, move, rename, a screen's album | yes | yes | no | no | no |
| Change the limits, import from Home Assistant | yes | no | no | no | no |
| An album's list and screen-sized photos and thumbnails (the saver) | yes | yes | yes | yes | no (404) |
| An original | yes | yes | no | no | no |

`feature:media` is decided as `music` (authz.py), as the HA folder's photos are. Every change needs the CSRF
token and is written to the audit log as a `config` row: `photos.album.create|rename|delete`, `photos.upload`,
`photos.delete`, `photos.move`, `photos.limits`, `photos.screen`, `photos.import.start|finish|cancel`.

### Import from Home Assistant

An Owner gives a media folder (`media-source://media_source/…`, prefilled with the house's Screensaver Photos)
and an album. Mantel, with its own HA connection:

1. walks the folder with `media_source/browse_media` (three folders deep, at most 5,000 pictures; anything not
   under `media-source://media_source/`, a camera for instance, is skipped);
2. resolves each picture with `media_source/resolve_media` (a server-only read; a page can never ask it);
3. reads it from **HA Core directly** with HA's own short-lived signature (`?authSig=…`), never with Mantel's
   token. Under the HA App, Mantel's `ha_url` is the Supervisor's proxy, which only passes `/api/…`, so the
   picture is read from `ha_oauth_url` (`http://homeassistant:8123`); elsewhere from `ha_url`;
4. adds it like an upload (same checks, same limits; a duplicate by hash is skipped).

One import at a time, in the background; the page shows its progress and can stop it; the last result stays
on the page with the pictures that could not be copied and why. Nothing in Home Assistant is written or deleted.

### Backups

`<data_dir>/photos` goes into Mantel's encrypted backup with "Your files" (`--no-files` leaves both out; the
manifest counts `photos`), and `restore` puts it back (0700/0600) with the rows in the database. Under the HA
App `/data` is in Home Assistant's backups of the App too. The Storage group says which, with the size.

## REST

| Route | Who |
|---|---|
| `GET /api/photos` (albums with count, size and cover; usage; limits; screens; backups; the import) | manager |
| `POST /api/photos/albums` `{name}`; `PATCH`/`DELETE /api/photos/albums/<id>` | manager |
| `GET /api/photos/albums/<id>/photos` | manager |
| `POST /api/photos/albums/<id>/upload` (multipart `file`) → 201, or 200 `duplicate` | manager |
| `POST /api/photos/delete` `{ids}`; `POST /api/photos/move` `{ids, album}` (→ `moved`, `skipped`) | manager |
| `PUT /api/photos/limits` `{quota_mb?, file_mb?}` | Owner |
| `PUT /api/photos/screens/<screen>` `{album \| null}` | manager |
| `GET`/`POST`/`DELETE /api/photos/import` | manager reads; Owner starts and stops |
| `GET /api/photos/screens`; `GET /api/photos/albums/<id>/show` (`Cache-Control: no-cache`) | feature:media |
| `GET /api/photos/<id>/screen` and `/thumb` (`private, max-age=31536000, immutable`, ETag); `/original` | feature:media; original: manager |

A refused or missing album or photo for the saver's routes answers one 404 (nothing to probe).

## Tests

* `tests/test_photos.py`: albums, re-encoding (orientation, no EXIF/GPS, 0600/0700), PNG/WebP/HEIC, three sizes,
  refusals in words, duplicates (also racing), both limits and who changes them, delete/move many, a screen's
  album and what the saver reads with its cache headers, RBAC (signed out, Adult, Guest, wall tablet, Admin),
  CSRF, the audit rows, the import against a fake HA (signature only, no token, cameras skipped, duplicates on a
  second run), the backup and restore.
* `tests/test_mantel_photos_js.py`: the page in node with a recording kit: albums, storage and backups, the
  Owner-only rows, the grid, select, move and delete as sent, twenty uploads three at a time with each file's
  words, the pickers; the shell's `photoSource`/`listPhotos` with and without the Ingress prefix.
* HK's saver suite (`test_saver.js`): a host with its own photos is listed by the host and shown from its
  addresses, never browsed or resolved; without one, the house's folder again.

## Not done / for Avery

* Not installed on the house. The App's image now installs Pillow and pillow-heif: the next App build pulls two
  more wheels (both have manylinux amd64/aarch64 wheels).
* A tablet sees an album's new photos at its next listing (up to 30 minutes), or at once in the browser that
  made the change.
* The browser check ran against a local Mantel with fictional photos and a fictional HA folder (never the house):
  twenty files dropped at once (HEIC among them, a duplicate and a text file reported in words), the preview,
  selecting and deleting three, an import, an album on a screen and that screen's screensaver showing it.
