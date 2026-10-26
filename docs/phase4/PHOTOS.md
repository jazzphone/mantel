# Mantel Photos: the screensavers' own photo library (2026-10-19)

HK's Photo Screensaver shows the pictures in a Home Assistant media folder (All Screens → Screensaver →
Screensaver Photos, `media-source://media_source/local/photos`). On Mantel those photos stopped loading: the
screensaver resolves each one with `media_source/resolve_media`, and HA's answer is a signed address on HA's
own origin that a Mantel page can't load. The quick fix (main, `connectors/media_photos.py`) answers that read
in Mantel. This is the longer-term answer Avery asked for: *"move all of this to Mantel with a way to upload
photos into bulk, and even have a list/preview/way to delete them"*. Confirmed: bulk upload, a grid with a
preview, delete, albums, and an import from Home Assistant.

Built and tested offline and against a local Mantel with fictional photos. Shipped in App 0.1.29. Nothing changes
in HK Frontend inside Home Assistant.

**Where it is (Avery, 2026-10-19: "It isn't under Your Files, which is probably where it should be").** Photos is
inside Your Files (Mantel Settings → Your Files → Photos), not a sidebar row of its own; and a screen's Screensaver
pickers make an album and add photos to it in place (below).

## What it is

| Part | Where |
|---|---|
| Storage, processing, REST, the HA import | `hosts/server/mantel_server/photos.py` |
| The picture work, in its own process | `hosts/server/mantel_server/imaging.py` (the worker, the slot, the fallback) and `image_work.py` (decode, re-encode, faces) |
| The records | migration `0018_photos.sql`: `photo_albums`, `photos`, `photo_screens`, `photo_settings` |
| Mantel Settings → Your Files → Photos | `web/shim/mantel-photos.js` (wired in `mantel-settings.js` `pFiles`; Owner and Admin). Its address is `#/mantel/files/photos`; the old `#/mantel/photos` (and `/admin`'s `#photos`) forward there |
| The screensaver's side | `web/hk/modules/hk-saver.js` asks the host (`hkShell.photoSource` / `listPhotos`, `web/client/hk-host-shell.js`); Mantel's answers are in `web/shim/mantel-shell.js` |
| The pickers on HK's pages | `web/hk/panels/hk-settings.js` calls the host's `extend('saver', …)` (a screen's Screensaver Options) and `extend('house-saver', …)` (All Screens → Screensaver) |
| Backups | `backup.py` packs and restores `<data_dir>/photos` with "Your files" |
| Dependencies | `pillow-heif` is now a dependency (HEIC); `Pillow` and `pillow_heif` are pinned in `packaging/ha-app/requirements.txt` (the App image had no Pillow before) |

### Albums and sources

An album is a named set of photos; each photo is in exactly one album. A screensaver's source is either a Home
Assistant media folder (`media-source://…`, as before), HK's landscapes (Behind the Clock: Landscapes, as
before), or an album, named `mantel-photos://<album id>`.

* **A screen's own album.** Its Screensaver Options page gets a Photos group: *Show: Screensaver Photos (All
  Screens) / an album / New Album…*. New Album… asks for a name, makes the album and picks it; with an album
  picked, *Add Photos to <album>…* is right there (the album page's own bulk upload, its progress listed under
  the picker), so a screen's photos are set up without leaving its settings. Mantel keeps that choice (`photo_screens`), not HK's settings, so HK's settings model and
  Home Assistant's copy never see it. Deleting the album takes the screen back to the house's photos.
* **Every screen's album.** All Screens → Screensaver gets *Mantel Photos Album* under Screensaver Photos, with the
  same New Album… and Add Photos…. It
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
* **original**: full size up to 8192 px on the long side, progressive JPEG q90 (a re-encode, so no location
  survives; the uploaded bytes are not kept);
* **screen**: 2560 px, progressive JPEG q85 (what the screensavers show);
* **thumbnail**: 480 px, WebP (the grid).

The SHA-256 of the bytes as they came in is kept: the same picture twice in one album is skipped
(`duplicate: true`), also when two uploads of it race.

### Where the work runs (`imaging.py`, `image_work.py`)

Decoding and re-encoding (Mantel Photos' `process`, Your Files' `reencode_photo`) and looking for faces (on upload
and in the backfill) run in **one worker process**, one picture at a time; the server keeps every write.

* **The worker.** A `ProcessPoolExecutor(max_workers=1)` with the `spawn` start method: a fresh interpreter that
  imports `image_work.py`, `faces.py` and Pillow, never the server. It starts on the first picture and stops after
  5 idle minutes (`imaging.IDLE`). ONNX Runtime and the face detector live there only (one detector for the
  worker's life); the server process never imports ONNX Runtime and learns whether faces can be found from the
  worker (`imaging.faces_available`; before the worker has said, from whether the packages are installed).
  Mantel's images start the server as `python -m mantel_server`, which multiprocessing does not re-import in the
  worker.
* **One at a time.** `imaging.run` waits for the image slot (MED-2) before it sends a job; the slot is given back
  when the job ends, also when its caller was cancelled (the worker can't be stopped mid-picture). Uploads, the
  import from Home Assistant, Your Files' photos and the face backfill's `look` all queue there.
* **Plain data.** Bytes or a path go in; encoded bytes, sizes and face boxes come out. The server checks the quota,
  writes the audit row (before the change), the files and the row; a cancelled add still leaves no files.
* **Progressive JPEG again.** MED-1 turned the progressive, optimized encode off because it held the server's GIL
  (a 48 MP picture froze every client for ~0.75 s). In the worker it holds only the worker's: the event loop's
  worst stall during a 30 MP upload is under 20 ms with it on (`test_photos.py`).
* **When the worker dies** with a picture (out of memory, a decoder crash), that picture is refused as unreadable;
  it is never run again in the server's own process. The next picture starts a new worker.
* **When no worker can run** (no new processes, or no `/dev/shm` for the pool's semaphores), or after a second
  death, the work runs in a thread of the server as before -- baseline JPEG, so the loop keeps running -- and one
  warning says so (`picture work runs in a thread from now on`).
* **Containers.** The worker needs a process (the pool also starts multiprocessing's resource tracker: two more of
  `pids_limit: 256`), and `/dev/shm` for its semaphores: Docker gives every container a 64 MB `/dev/shm` whatever
  `read_only` says, and neither compose.yaml nor the HA App overrides it. No temporary files are written (`/tmp`
  is not used). After each picture the worker hands freed memory back to the system (`malloc_trim`, Linux).
* **Memory** (measured 2026-10-26 on macOS arm64, a 48 MP JPEG of 19.6 MB, peak RSS). In the worker: the server's
  process 49 → 69 MB, the worker 73 → 711 MB, 1.3 s with progressive encode. In a thread (the fallback): the
  server's process 49 → 601 MB, 0.6 s. An idle worker is about 70 MB; with the face detector loaded, some tens of MB
  more. Not yet measured in the Linux images (Docker was not running).

### Limits (a setting)

| Limit | Default | Range | Who changes it |
|---|---|---|---|
| One upload (`file_mb`) | 40 MB | 1-200 MB | Owner |
| All photos, every stored size (`quota_mb`) | 4 GB | 100 MB-1 TB | Owner |
| Pixels | 64 megapixels (100 before the audit's second pass, MED-2) | fixed | |
| Albums / photos per album | 200 / 20,000 | fixed | |

Your Files → Photos → Storage shows the space used against the limit.

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
   picture is read from HA Core's own address (`media_photos.core_url`, as main's screensaver fix: `ha_oauth_url`, else `http://homeassistant:8123` under the App); elsewhere from `ha_url`;
4. adds it like an upload (same checks, same limits; a duplicate by hash is skipped).

One import at a time, in the background; the page shows its progress and can stop it; the last result stays
on the page with the pictures that could not be copied and why. Nothing in Home Assistant is written or deleted.

### Backups

`<data_dir>/photos` goes into Mantel's encrypted backup with "Your files" (`--no-files` leaves both out; the
manifest counts `photos`), and `restore` puts it back (0700/0600) with the rows in the database. Under the HA
App `/data` is in Home Assistant's backups of the App too. The Storage group says which, with the size.

### Keep in View: focus points (2026-10-22)

The screensavers crop to fill (a single photo with `object-fit: cover`, a mosaic cell through `coverRect`), so
faces were cut off. Mantel now finds where each photo's faces are, once, and the screensavers crop and zoom
around them. Only boxes are found and stored, never who anyone is, and nothing leaves the server.

* **Data** (migration `0024_photo_focus.sql`). `photos.faces` is JSON `[[x, y, w, h, score], …]`, fractions of
  the upright picture: the kept faces only, at most 12, largest first. `NULL` means not checked yet, `'[]'` means
  checked with no faces. `faces_at` and `faces_by` (`yunet-2023mar`) record when and by what, so a later model can
  check again. `focus_x`/`focus_y` hold a point set by hand (`NULL` = automatic); going back to automatic clears
  only them, and the detected faces stay. A partial index `photos_unchecked` on `created WHERE faces_at IS NULL`
  serves the backfill. The focus is worked out on read (`photos.with_focus`): `hand`, else `faces` (the centre of
  the faces' union), else `none`, or `pending` while unchecked.
* **Detector** (`faces.py`). YuNet `face_detection_yunet_2023mar.onnx` (MIT, OpenCV Zoo, vendored in
  `mantel_server/models/` with its licence; SHA-256 checked before loading), run by ONNX Runtime on the CPU with
  one thread. The model's input is a fixed 640x640: the picture is scaled to 640 px on its long side and padded.
  Its outputs are decoded and duplicates removed in `faces.decode`/`faces.nms`, matching OpenCV's
  `FaceDetectorYN` (checked against it to within 2e-4 px). Score at least 0.7; faces under a quarter of the
  largest's area are dropped (`keep`). It runs in the image worker process (see "Where the work runs"), which keeps
  one `Detector` for its life; the server process never imports ONNX Runtime.
* **On upload.** `process()` runs the detector on the screen-sized copy it has just made, in the same worker. `Processed.faces` is `None` when there's no detector or it fails, and the upload never fails because of
  it.
* **Backfill** (`FaceBackfill`, `app["photos_faces"]`). It starts 60 s after the server, then takes one unchecked
  photo at a time (newest first): the worker reads `screen/<id>.jpg` and detects (`imaging.look`, in its turn with
  the uploads), the server writes the row, and it rests 0.5 s. It waits while an import runs and stops when nothing is left. A restart carries on, because the state
  is the rows. An unreadable file is stored as `'[]'`. Nothing runs without a detector. When it finishes, it logs
  at info "checked N photos for faces in Xs (M with faces)". It's cancelled on cleanup.
* **Screensaver** (`hk-saver.js`, shared with HK Frontend; does nothing without focus data). `hostPhotoList`
  passes on `cleanFocus(p)`. `faceWindow` returns the crop alignment: a hand-set point is centred; otherwise all
  the faces when their union (with room for each head) fits the visible window at the shape's zoom, else the
  largest face plus as many more, largest first, as still fit. `faceOrigin` sets the zoom origin (`--org`, which
  falls back to `--pos`) so a zoom closes in on the faces, whether the photo fills the screen or is shown whole.
  The Mosaic uses `faceWindow` per cell. `mosaicPlan(…, portraits)` picks among the layouts whose tall cells
  best match the number of portrait photos (never the last one shown). That last part is in both products, so HK
  Frontend gets it at its next publish.
* **Shim.** `mantel-shell.js listPhotos` passes on a valid `focus`/`faces`. In the photo viewer
  (`mantel-photos.js`), **Keep in View** shows the faces as boxes and a hand-set point as a ring. A tap sets the point,
  **Automatic** puts it back, and Enter centres it.
* **Setup Check.** One line, only when the library has photos and the detector is unavailable.
* **Size cost** (measured 2026-10-22 in the App's base image). onnxruntime 1.31 + numpy 2.5 (+ flatbuffers,
  packaging, protobuf) add about 130 MB installed on aarch64 and 140 MB on amd64, and about 45–48 MB to the
  compressed image. opencv-python-headless + numpy would have added 154/222 MB. Detection takes 13 ms per photo
  on aarch64 and 22 ms on amd64 (emulated), with one thread.

## REST

| Route | Who |
|---|---|
| `GET /api/photos` (albums with count, size and cover; usage; limits; screens; backups; the import; `faces`) | manager |
| `GET /api/photos/faces`: the faces backfill, counted from the rows (`photos`, `checked`, `with_faces`, `left`; `state` `running`, `waiting` for an import, `done`, `stopped` or `unavailable`; `started`, `finished`). Photos polls it every 4 s while it looks | manager |
| `POST /api/photos/albums` `{name}`; `PATCH`/`DELETE /api/photos/albums/<id>` | manager |
| `GET /api/photos/albums/<id>/photos` (each with `faces` and `focus {x, y, by}`) | manager |
| `PUT /api/photos/<id>/focus` `{x, y}` (0..1) or `{auto: true}`; audited `photos.focus` | manager |
| `POST /api/photos/albums/<id>/upload` (multipart `file`) → 201, or 200 `duplicate` | manager |
| `POST /api/photos/delete` `{ids}`; `POST /api/photos/move` `{ids, album}` (→ `moved`, `skipped`) | manager |
| `PUT /api/photos/limits` `{quota_mb?, file_mb?}` | Owner |
| `PUT /api/photos/screens/<screen>` `{album \| null}` | manager |
| `GET`/`POST`/`DELETE /api/photos/import` | manager reads; Owner starts and stops |
| `GET /api/photos/screens`; `GET /api/photos/albums/<id>/show` (`Cache-Control: no-cache`; a photo has `focus: [x, y]` only when set by hand and `faces: [[x, y, w, h], …]` only when found) | feature:media |
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
* `tests/test_photo_faces.py`: `keep`, the YuNet decoder and NMS on synthetic tensors, the model's SHA-256 and a
  smoke test on blank pictures, faces stored on upload (and an upload without or despite a failing detector), the
  backfill (newest first, one at a time, resumes, unreadable files, no detector, waits for an import), the
  migration over existing photos, what the screensavers and the page read, `PUT …/focus` (roles, CSRF, bad
  values, auto, audit) and the Setup Check line.
* `tests/test_saver_focus.py`: hk-saver.js in node: `faceWindow` (centring, edges, fits or the largest cluster,
  a hand-set point, zoom), `faceOrigin`, `cleanFocus`, `mosaicPlan` by shape, and inertness without a focus.
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
