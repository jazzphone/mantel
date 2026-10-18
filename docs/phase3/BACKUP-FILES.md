# Encrypted backups with a tested restore, and the "Your files" upload (2026-10-18)

PLAN §4 ("What HK reads from HA's disk today, and must move") and §7 ("Container and host", "Secrets").
Two modules, both with `register(app, hub)`; **neither is wired into `server.py` yet** (the orchestrator
does that: "Wiring" below). Nothing here touched a real Home Assistant, the house, or `~/.config/mantel`.

| Path | What |
|---|---|
| `hosts/server/mantel_server/backup.py` | The encrypted backup format, `create_backup` / `restore` / `rotate`, the nightly job (`Backups`), `GET /api/backup`, `POST /api/backup/run`, and the CLI (`mantel-server backup`, `mantel-server restore`). |
| `hosts/server/mantel_server/user_files.py` | The Your files store, its checks, upload/list/delete REST, HA's `image/upload` + `image/serve` contract, serving at HK's URLs, and the one-time import (`mantel-server import-files`). |
| `hosts/server/mantel_server/config.py` | New options: `--hk-files`, `--backup-target`, `--backup-key-file`, `--backup-time`, `--backup-keep-daily`, `--backup-keep-weekly`, `--backup-no-files`; `Config.user_files_dir`. |
| `hosts/server/mantel_server/__main__.py` | Dispatches `backup`, `restore`, `import-files`. |
| `pyproject.toml` | `Pillow>=11.0` is now a dependency (photos are re-encoded); extra `heic = ["pillow-heif>=0.18"]`. `.gitignore`: `user-files/`, `*.mbk`. |
| `tests/test_backup.py` (29), `tests/test_user_files.py` (63), `tests/test_user_files_guard.py` (3) | See "Tests". |

## 1. Backups

### What a backup is

One file per run, `mantel-YYYYmmdd-HHMMSS.mbk` (UTC), in the target folder (the NAS mount in production).
Inside, sealed, is a gzip tar of:

* `mantel.db`: a consistent snapshot from **SQLite's online backup API** (`sqlite3.Connection.backup`), so it is
  safe while the server writes and in WAL mode; the snapshot is switched to a single plain file
  (`journal_mode=DELETE`) and checked with `PRAGMA integrity_check` before it is packed;
* `manifest.json`: schema version, row count per table, creation time, whether files are included;
* `user-files/...`: the Your files tree (fonts, glyphs, photos), unless `--backup-no-files`.

The plaintext snapshot and tar are built in a 0700 `.backup-work-*` folder **inside the local data dir** and
removed afterwards; only the sealed file ever touches the target. The sealed file is written as
`.<name>.tmp`, fsynced, then renamed, so a half-written backup is never mistaken for a good one.

### Format (`MANTELBK` v1)

```
"MANTELBK" 8 | version 1 | salt 16 | nonce prefix 8 | chunk size u32 (1 MiB) | meta_len u16 | meta JSON | check 32
then chunks: AES-256-GCM(plaintext chunk) + 16-byte tag
```

* `meta` is readable without the key (`created`, `schema`, `files`; `mantel-server restore` and
  `backup.read_meta` use it) and is authenticated by `check` = HMAC-SHA256 over the whole header with a key
  derived from the secret, so **a wrong key is told apart from damage** (`wrong_key` vs `corrupt`).
* Per file, HKDF-SHA256(secret, random salt) derives an encryption key and a header-check key. Every chunk's
  nonce is the 8-byte random prefix plus a 4-byte counter; its associated data is `sha256(header)` + the
  counter + a *final-chunk* flag, so a chunk that was reordered, dropped, edited or cut off fails to open.
  Truncation at a chunk boundary is caught by the missing final flag.
* The file is streamed, never held whole in memory (DB size is not a limit).

### The key

`<secrets_dir>/backup.key` (override `--backup-key-file`): base64url of 32 random bytes, file 0600, folder 0700,
the same format as `at_rest.key`.

* **Separate from the at-rest key, not derived from it** (decision). The backups sit on the NAS; the at-rest key
  sits with the server. If one place is stolen, the other still holds.
* `mantel-server backup` and the nightly job **create** it if missing and say so loudly (log warning / stderr:
  "copy it somewhere that is not this machine"). `restore` **never** creates a key (a made-up key cannot open
  anything): a missing key is `key_missing`.
* **Two files must be kept off the box**, in your password manager or on paper: `backup.key` **and**
  `at_rest.key`. The database holds values sealed with the at-rest key (TOTP seeds and the like); a restored
  database without the matching `at_rest.key` loses those. Under Docker both are mounted secrets
  (`/etc/hk/secrets/`).

### Rotation

After each successful backup (never after a failed one), files in the target named `mantel-YYYYmmdd-HHMMSS.mbk`
are thinned: keep the newest backup of each of the last **N daily** (default 7) days that have one, plus the
newest of each of the last **M weekly** (default 4) ISO weeks that have one (UTC). The backup just written and
the newest in the folder are always kept. Nothing else in the folder is touched (no other names, no
subfolders, no `.tmp`). `--backup-keep-daily` (>= 1), `--backup-keep-weekly` (>= 0).

### Target safety

The target folder **must already exist**: a missing mount is `target_missing` ("is the NAS mounted?"), never a
new folder on the local disk that silently fills up. `mantel-server backup --create` creates it for a manual run.

### The nightly job

Enabled only when `--backup-target` is set (otherwise `register` adds `GET /api/backup` answering
`{"enabled": false}` and nothing else). At startup, if there is no backup newer than 25 h it makes one after
60 s; then it runs daily at `--backup-time` (default `03:15`) in the house time zone (`cfg.house_tz`); a
failure is logged at error level, recorded in `app["backups"].status`, audited (`backup.failed`), and retried in
an hour. Each run is audited (`backup.ok` / `backup.failed`, kind `config`, actor `mantel`).

REST (Owner/Admin sign-in; `run` is Owner-only and CSRF-checked):

| | |
|---|---|
| `GET /api/backup` | `{enabled, target, time, keep_daily, keep_weekly, key_present, status{last_ok,last_error,last_file,...}, backups[{name,created,size}]}` |
| `POST /api/backup/run` | a backup now; `{ok, file}` or 500 `backup_failed` |

### Restore procedure

Run on the (new) box with the server **stopped**. `<key-dir>` is where `backup.key` was copied back to.

```bash
# 0. test any backup, any time: decrypts and checks everything, changes nothing
mantel-server restore /mnt/nas/mantel/mantel-20261018-081500.mbk --data-dir /tmp/mantel-try --secrets-dir <key-dir> --verify-only

# 1. restore into a FRESH data dir (the normal case: a rebuilt container/LXC)
mantel-server restore /mnt/nas/mantel/mantel-20261018-081500.mbk --data-dir /data --secrets-dir <key-dir>

# 2. put at_rest.key (its copy) in <secrets-dir> too, then start Mantel Server
```

Before anything is moved, `restore`: decrypts into a staging folder inside the destination (`.restore-*`);
unpacks the tar by hand (only regular files/folders named `mantel.db`, `manifest.json`, `user-files/...`;
absolute paths, `..`, links and anything else are refused; a 16 GiB unpack ceiling); then checks the restored
database: `PRAGMA integrity_check` = ok, `PRAGMA foreign_key_check` empty, `schema_version` present and every
version known to this build (`schema_too_new`: "update Mantel first"), the row count of every table equal to the
manifest's, and that this build's migrations run on it (an older backup is brought forward in the staging copy
and the migrations applied are reported). Only then does it move files into place. Any failure leaves the data dir
exactly as it was and removes the staging folder.

* A data dir that already holds `mantel.db` (or its `-wal` / `-shm` / `-journal`) is refused
  (`data_dir_not_fresh`) unless `--replace`, which moves the old `mantel.db`, its sidecars and `user-files/` to
  `*.before-restore-YYYYmmdd-HHMMSS` (never deletes them). A stale `-wal` beside a new database would corrupt
  it, so sidecars always move aside.
* Errors have stable codes (printed as `restore failed (<code>)`): `key_missing`, `key_invalid`, `not_found`,
  `not_a_backup`, `unsupported_version`, `wrong_key`, `corrupt`, `database_invalid`, `schema_too_new`,
  `migration_failed`, `data_dir_not_fresh`, `swap_failed`, `target_missing`, `no_database`, `write_failed`.

**A restore drill** (do this once on the real NAS, then quarterly): `mantel-server backup --target /mnt/nas/mantel`,
then `mantel-server restore <newest> --data-dir /tmp/drill --verify-only`, then a real restore into an empty
folder and `mantel-server --data-dir /tmp/drill ...` against it. The unit tests do the same on temp folders;
the NAS leg has not been run (no NAS was touched).

## 2. Your files

### Where things live and what URL serves them

Everything is under `<data_dir>/user-files` (`Config.user_files_dir`; `/data/user-files` in the container),
**outside the web root**, folders 0700, files 0600, folder capped at 1 GiB. Nothing is ever served by
directory listing; each URL maps to one checked file.

| URL (same as today) | Stored at | Content-Type |
|---|---|---|
| `/hk/fonts/<name>` (`SF-Pro.woff2`, `SF-Pro.ttf`, ...) | `hk/fonts/` | `font/woff2`, `font/ttf`, `font/otf` |
| `/hk/iconset/hk-glyphs.js` | `hk/iconset/hk-glyphs.js` | `text/javascript` |
| `/hk/<folder>/<name>` image overrides (e.g. `sky/clouds-a.webp`), **import only** | `hk/...` | `image/*` |
| `/api/image/serve/<32hex>/<size>` (the address HK stores for a background/screensaver photo; any size name serves the original) | `photos/<id>.jpg|png|webp` | `image/*` |
| `/local/<path>` images imported from HA's `www`, **import only** | `local/...` | `image/*` |

All behind the same sign-in as the rest of Mantel (a signed-in person or an enrolled tablet). Responses carry
`Cache-Control: no-cache` (always revalidated; `FileResponse` adds ETag/304) and `X-Content-Type-Options:
nosniff`. Lookup order for `/hk/<path>`: the uploaded file, then `cfg.hk_files` (`--hk-files`, a dev or
bind-mounted folder), then `shared_assets` and `web/hk` (HK's bundle), i.e. an upload wins over the bundle
exactly as HA's Your files folder did. Served paths reject `..`, hidden names, symlinks, anything not a regular
file inside the folder, and any suffix outside woff2/ttf/otf/js/jpg/png/webp.

This is a **middleware** (`serve_user_files`, appended after the sign-in middleware), not a route, so it does
not depend on whether it was registered before or after `server.py`'s `/hk/{path:.+}` catch-all.

### Uploading (Owner or Admin; a signed-in person, never a tablet alone; CSRF required)

| | |
|---|---|
| `GET /api/user-files` | what is stored (`fonts`, `glyphs`, `photos`, `overrides`, `local`), `status{font,glyphs}` (is `SF-Pro.woff2`/`.ttf` there? glyphs?), `usage`, `quota`, `limits` |
| `POST /api/user-files/font` | multipart `file` (+ optional `name`). `201 {url:/hk/fonts/<name>}` |
| `POST /api/user-files/glyphs` | multipart `file` |
| `POST /api/user-files/photo` | multipart `file`. `201 {id, url:/api/image/serve/<id>/original}` |
| `DELETE /api/user-files/{font|glyphs|photo}/{name}` | remove one (`name` = file name, any for glyphs, photo id) |
| `POST /api/image/upload` | HA's contract (multipart `file` -> `{id}`), so HK Settings' photo upload (`/api/image/upload` through `actions.request`) works unchanged |
| `DELETE /api/image/<id>` | the REST form of HK's `image/delete` |

Errors are `{"error": code, "message": ...}`: `too_large` (413, checked while streaming and by Content-Length),
`quota_exceeded` (413), `multipart_required`/`file_required`/`bad_name` (400/415), `font_invalid`,
`font_type_mismatch`, `glyphs_invalid`, `photo_invalid`, `photo_too_large`, `heic_unsupported` (415). Every
change writes an audit row (`user_files.upload.*`, `user_files.delete.*`).

What is checked (always the bytes, never the name or the browser's content type):

* **Fonts** (40 MB): magic `wOF2` (length field must equal the file size) or sfnt `00010000`/`true`/`OTTO` with a
  sane table directory (every table inside the file). The extension must agree with the bytes
  (`font_type_mismatch`). Names: last path part, NFKC, `[A-Za-z0-9._-]`, no leading dot, **case kept** (HK asks
  for `SF-Pro.woff2` exactly), extension lowercased; a percent-encoded name from a client is decoded first.
* **Glyphs** (2 MB): accepts the file `tools/sf_symbols/build_glyphs.py` writes, or the same data as JSON. The
  upload is **parsed as data, never executed**: leading `//` comments and the one `hkGlyphs =` assignment are
  recognised, everything outside string literals must be punctuation, digits or the five bare keys
  (`icons`, `twotone`, `weather`, `path`, `secondaryPath`), then `json.loads`. Shape: `icons` non-empty
  `{name: SVG path}`, `twotone` `{name: {path, secondaryPath}}`, `weather` `{name: [viewBox, [[role, path], ...]]}`;
  names `[A-Za-z0-9._-]`, paths only SVG path characters. **What is stored and served is re-rendered by
  `render_glyphs`**, so uploaded bytes (comments, `</script>`, code) never reach a browser; the file is the
  same shape HK's `hk-icons.js` loader reads.
* **Photos** (25 MB, 60 megapixels): jpeg / png / webp (heic when `pillow-heif` is installed, else
  `heic_unsupported`), decoded by Pillow and **re-encoded**: EXIF/GPS/ICC dropped (wide-gamut converted to
  sRGB when an ICC profile exists), rotation applied, long edge <= 3840, first frame only, JPEG q88 /
  PNG (alpha kept) / WebP q88; HEIC becomes JPEG. SVG, GIF, PDF, polyglots and decoder failures are
  `photo_invalid`. The stored id is 32 random hex characters, the shape HA's image store used.

### Supplying SF Pro and the glyph set (the three licensed files)

Apple's files are the only ones HK *needs* from Your files: `fonts/SF-Pro.woff2` (or `SF-Pro.ttf` if you have no
woff2; a browser that gets a 404 for the woff2 moves on to the ttf) and `iconset/hk-glyphs.js`. No other licensed
asset is referenced by `web/hk` (`sf-pro.css` and `hk-icons.js` are the only users, and they are in git).
Without them the pages draw with fallback fonts and missing glyphs, and the URLs 404, as before.

Two ways for an Owner or Admin to add them, both kept in `<data_dir>/user-files` (so in the encrypted backups):

* **/admin, Your files, "HK fonts and glyphs"**: three slots (SF Pro woff2, SF Pro ttf, HK glyphs), each with
  Upload/Replace/Remove. The slot fixes the stored name, so the file may be called anything; the bytes are
  checked (woff2/ttf by structure and the extension must agree, 40 MB; the glyph file is parsed as data and
  rewritten by Mantel, 2 MB). It calls `POST /api/user-files/font` (field `name`) and `/glyphs`.
* **`mantel files import-assets <folder> [--dry-run]`** (the container's entrypoint passes `files` through, and
  it defaults `--data-dir` to `/data`): looks in `<folder>` for exactly `fonts/SF-Pro.woff2`,
  `fonts/SF-Pro.ttf` and `iconset/hk-glyphs.js`, directly or under `hk/`, `www/hk/`, `frontend/`,
  `custom_components/hk_frontend/frontend/` or `hk_local/`, or the three files lying flat in the folder.
  Nothing else in the folder is read. Each file passes the upload checks; symlinks are not followed; exit code
  1 if none was found. Idempotent.

On a Home Assistant install they are where they were put by hand: `/config/www/hk/fonts/SF-Pro.woff2`,
`/config/www/hk/iconset/hk-glyphs.js` (also check `/config/hk_local/` and
`/config/custom_components/hk_frontend/frontend/`). Copy that folder off HA first (Samba or `scp`), then
`docker compose cp ./hk mantel-server:/tmp/hk && docker compose exec mantel-server mantel files import-assets /tmp/hk`.

They are served at `/hk/fonts/SF-Pro.woff2`, `/hk/fonts/SF-Pro.ttf` and `/hk/iconset/hk-glyphs.js` with
`font/woff2`, `font/ttf`, `text/javascript`, an ETag (revalidated, 304) and `nosniff`, to anyone signed in
(the page fetches them). Through HA Ingress they sit under the page's prefix like every other `/hk/` file: the
stylesheet's `url("/hk/fonts/SF-Pro.woff2")` is rewritten to the prefix, and `hk-glyphs.js` contains no absolute
path (it is written by Mantel and loaded relatively), so it needs no rewrite. They never enter git, an image or
the staged App (`tools/stage_ha_app.py` refuses font files and `hk-glyphs*`; `tests/test_stage_ha_app.py`).

### The one-time import

```bash
mantel-server import-files /path/to/hk_local \
    [--images /path/to/config/image] [--www /path/to/config/www] --data-dir /data [--dry-run]
```

* `hk_local` (the old Your files folder): `fonts/*.woff2|ttf|otf` and `iconset/hk-glyphs.js` go through the same
  checks as uploads; any other image (`sky/clouds-a.webp`) is re-encoded to `hk/<same path>` and must keep the
  type its name says. **Everything else is skipped and listed with the reason**: `.js`, `.css`, `.html`, `.svg`,
  `.json`, video, hidden files, symlinks. (HA served any web file; Mantel serves only fonts, the glyph file
  and images, so a home's own probe pages or scripts do not carry over.)
* `--images` (HA's `image_upload` store, `<id>/original`): each 32-hex folder's original becomes
  `photos/<same id>.jpg|png|webp`, so settings that say `/api/image/serve/<id>/original` keep working untouched.
* `--www`: images only, to `local/<path>`, served at `/local/<path>` (the other form `SKY_PHOTO` accepts).
* `--dry-run` checks everything and writes nothing. It is idempotent (re-running overwrites with the same
  result). The import runs offline against copies on disk; it talks to nothing. Copy the folders off HA first
  (Samba or `scp`); the server does not need to be stopped.

### Not in git

`.gitignore`: `user-files/`, `*.mbk` (on top of the existing `**/SF-Pro*`, `**/hk-glyphs*`, `secrets/`,
`*.key`). Every font/glyph/photo in the tests is generated into a tmp folder at run time (a 100-byte fake
sfnt/woff2, a handful of glyph paths, Pillow-drawn pictures). `tests/test_user_files_guard.py` fails if any
font, glyph file, `user-files/` path, `.mbk` or key file is tracked, if those paths stop being git-ignored, or
if the two test files grow big enough to hide real data.

## Tests

`~/.venvs/mantel/bin/python -m pytest -q tests/test_backup.py tests/test_user_files.py tests/test_user_files_guard.py`

* Backup: round trip with a generated row in **every** table (the helper reads each table's columns, CHECKs and
  foreign keys from the migrations) compared row-for-row after restore, plus the user-files tree; no plaintext
  in the sealed file; a snapshot while another connection writes in WAL mode; wrong key (`wrong_key`, nothing
  written); flipped bytes, truncated tail, appended bytes, cut header, chunks swapped/dropped across a
  multi-chunk file, junk file, absent file; a sealed backup with a damaged database is refused and the live data
  dir is untouched; a tar with `..` or a symlink is refused; a newer-schema backup is refused; an older backup is
  migrated (4..7) before the swap; fresh-dir rule, `--replace` moves aside (stale WAL included), `--verify-only`;
  missing NAS mount is an error not a folder; the plaintext snapshot never touches the target; key file
  creation/permissions and "restore never invents a key"; rotation (140 files over 70 days, idempotent, foreign
  names untouched, clock-went-backwards, failed backup deletes nothing); the CLI end to end; `next_run`; the job's
  catch-up and nightly timing (fake clock/sleep) and failure reporting; the REST status/run through the real app
  with roles, CSRF and an audit row.
* Your files: fonts of each type, mismatched/garbage fonts, name normalisation, glyph JS (the build format,
  trailing commas, JSON) and hostile glyph payloads, photos (EXIF/GPS stripped and rotated, PNG alpha, WebP,
  big image shrunk, HEIC to JPEG and the no-decoder refusal, 9 non-picture/polyglot payloads, a pixel bomb),
  size caps while streaming and by Content-Length, the quota, wrong kind / non-multipart / no file, roles and CSRF
  and anonymous access, audit rows, precedence over `hk_files` and fall-back after delete, path escape attempts
  (encoded `..`, symlink, hidden, wrong type, PUT), the import CLI (dry run, skips with reasons, idempotent, then
  served at the old URLs), config options, and uploads surviving a backup/restore.

Validation at the time of writing (this worktree): full suite **1529 passed**; `tools/headless/client_smoke.py`
passes (`browser_exceptions: 0`, `external_requests: 0`). Pillow 13.0.0 and pillow-heif 1.8.1 were installed
into `~/.venvs/mantel` for this (a `pip install pillow pillow-heif`); a venv without Pillow fails the photo tests
(the other tests do not need it), and without pillow-heif only the two HEIC tests skip/behave as "no decoder".

## Wiring (the orchestrator; I did not edit `server.py`)

In `server.wire(app, hub, token, connect_ha)`, after `gateway.register_audit(app)` / `app["audit"] = audit` exists
(backup.register reads `app["audit"]` at registration):

```python
from . import backup, user_files          # next to the other slice imports

    # in wire(), after readproxy/health/settings registrations:
    user_files.register(app, hub)         # Your files: REST, /hk + /local middleware, /api/image/*
    backup.register(app, hub)             # nightly job (off without cfg.backup_target) + GET /api/backup
```

Nothing to add to `auth.PUBLIC_PATHS` (everything here is behind sign-in), and no change to `server.hk_file`
(the middleware answers first and falls through to it). `register` must run before the app starts (it appends a
middleware and startup/cleanup hooks), which `wire()` inside `build_app` satisfies.

Packaging follow-ups (not done, outside this slice): `packaging/docker/entrypoint.py` should pass
`MANTEL_BACKUP_TARGET` (plus `--backup-key-file` from the mounted secret `backup_key`) as the new flags, the
compose file needs the NAS mount at that target (the job refuses to create a missing target) and a `backup_key`
secret, and PACKAGING.md's "Your files" gap (open gap 3) is now closed by the upload/import. The Docker image
installs Pillow from `pyproject.toml`'s dependencies automatically; add `.[heic]`'s `pillow-heif` there if iPhone
HEIC uploads (rather than HK's own client-side JPEG shrink) must work in the container.

## Exact continuation point

1. **Wire** the two `register` calls above, run the full suite and `client_smoke`, and add one line to
   `tests/test_wiring.py` (or similar) that `build_app` exposes `app["user_files"]` and `app["backups"]`.
2. **UI (web agents):** an Owner/Admin "Your files" section in Mantel Settings calling `GET /api/user-files`,
   the three uploads and `DELETE`, showing `status.font` / `status.glyphs` the way HA's Repairs entries did
   ("SF Pro font not installed", "SF Symbols glyphs not installed"); a "Backups" card on `GET /api/backup` with
   "Back up now". HK Settings' photo upload already works through `POST /api/image/upload`; its
   `photoForget` still sends the WebSocket message `image/delete` through `actions.callWS` (refused at the action
   port today), so wire it to `DELETE /api/image/<id>` or accept leaving unused photos until a "forget" button.
3. **Real-NAS drill** on proxmox1: mount the NAS, set `--backup-target`, run `mantel-server backup`, then the
   restore drill in section 1; copy `backup.key` and `at_rest.key` into the password manager.
4. **Import** today's folder: copy `/config/hk_local`, `/config/image`, `/config/www` off HA, run
   `mantel-server import-files ... --dry-run`, read the skipped list, then for real; confirm `GET /api/user-files`
   shows `status.font` and `status.glyphs` true, and that settings which stored `/hk/...`, `/local/...` and
   `/api/image/serve/<id>/original` photo addresses draw.
5. Open design points, not decided here: image overrides under `/hk/<folder>` are import-only (no upload
   kind yet; add `POST /api/user-files/override` with a normalised relative path if a home needs it); backups are
   not mirrored anywhere but the one target (add a second target or Litestream if one NAS is not enough);
   backup time zone follows `house_tz`, ISO weeks and file names are UTC.
