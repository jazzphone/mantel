# Backups

Everything Mantel knows lives in its data folder: people, roles and grants, wall tablets, sessions, settings with their history, the audit log, your uploaded files and photos, and the saved connections to Home Assistant and Music Assistant. In the Home Assistant App, Home Assistant's own backups include it. With Docker or the LXC, Mantel makes its own **encrypted backup every night** to a folder you choose, and checks every backup before it restores it. Either way, two keys matter as much as the backups themselves.

## The two keys

Mantel seals some values in its database with the **at-rest key** (`at_rest.key`): authenticator app secrets, device keys and the saved connections. With Docker or the LXC, the backups are encrypted with a separate **backup key** (`backup.key`). The two are kept apart on purpose, so a stolen backup can't be opened with what sits on the server alone, and the other way round.

| Key | Without it |
|---|---|
| `at_rest.key` | A restored database loses every authenticator app and the saved connections: people set up their authenticator again, and you connect Home Assistant again. |
| `backup.key` | A backup can't be opened at all. |

**Keep a copy of both somewhere that is not the Mantel machine**, for example in your password manager. With Docker or the LXC they are in `/etc/hk/secrets`. A backup can be restored only with the `backup.key` it was made with.

## In the Home Assistant App

The App keeps its data in its own `/data` folder, and **Home Assistant's backups include it**: the database, the at-rest key (in `/data/secrets`), your files and photos, and, with built-in HTTPS, the certificate's key. There is no separate Mantel backup to set up.

- Make sure your Home Assistant backups run (**Settings** → **System** → **Backups**), and keep a copy off the machine.
- Protect them. A Home Assistant backup holds Mantel's at-rest key next to its database, plus password hashes and the audit log. Keep backups encrypted, and the encryption key somewhere safe.
- To get Mantel back, restore the App from a Home Assistant backup (all of it, or just the **Mantel** App).

<!-- CHECK: the App's config.yaml sets no `backup:` mode (so Home Assistant makes a hot backup while Mantel runs) and no pre-backup step; Mantel's database is SQLite in WAL mode. Confirm that a hot Home Assistant backup of /data restores a consistent mantel.db, or set `backup: cold` / add a snapshot step. -->

## With Docker or the LXC

### Turn on the nightly backup

The nightly backup is off until you give it a folder. Ideally that folder is on another machine, such as a NAS mounted on the Docker host.

1. Pick the host folder and make it writable by Mantel's user (uid 10001):

   ```bash
   install -d -m 0750 -o 10001 -g 10001 /mnt/nas/mantel
   ```

   The LXC script already made `/opt/mantel/packaging/compose/backups` this way.
2. In `packaging/compose/.env`:

   ```bash
   MANTEL_BACKUP_DIR=/mnt/nas/mantel
   MANTEL_BACKUP_TARGET=/backups
   ```

   `MANTEL_BACKUP_DIR` is the folder on the host; Mantel sees it as `/backups`. Setting `MANTEL_BACKUP_TARGET` is what turns the nightly backup on.
3. `docker compose up -d --wait`.

If there is no backup from the last 25 hours, Mantel makes one a minute after it starts. After that it runs every night at **03:15**, in your house's time zone: the one Home Assistant is set to (**Settings** → **System** → **General**), once Mantel has reached Home Assistant. Until then, or without Home Assistant, it uses `--house-tz` (UTC unless you set it; see the flags below). Each backup, and each failure, is written to the [audit log](Commands-and-Audit.md); a failure is retried an hour later.

The folder **must exist**: if your NAS isn't mounted, the backup fails with `target_missing` instead of quietly filling the local disk.

### What a backup holds

One file per backup, named `mantel-YYYYmmdd-HHMMSS.mbk` (the time in UTC), encrypted with `backup.key`:

| Inside | |
|---|---|
| The database | A consistent snapshot, safe to make while Mantel runs, checked before it is packed |
| Your files and Mantel Photos | Apple's font and glyphs you uploaded, and the screensavers' photos |
| The saved connections | Home Assistant's and Music Assistant's, still sealed with `at_rest.key` |
| [Mantel Connect](Mantel-Connect.md)'s certificates | Its own certificate authority and keys, so a paired Connect App keeps working after a restore |

Not inside: the secret files in `/etc/hk/secrets` (keep your own copy of the two keys), `.env`, and Caddy's certificates (Caddy gets new ones).

Mantel keeps the newest backup of each of the last **7 days** and of each of the last **4 weeks**, and deletes older ones in that folder. It touches no other file there.

To change the time, its time zone or how many are kept, add flags to the `command:` list in your `compose.local.yaml` ([Install with Docker → Your own additions](Install-Docker.md#your-own-additions)):

| Flag | Default |
|---|---|
| `--backup-time HH:MM` | `03:15` |
| `--house-tz ZONE` | `UTC`. Used only until Mantel has Home Assistant's time zone, or without Home Assistant. Your time zone's name, for example `Europe/London`. |
| `--backup-keep-daily N` | `7` |
| `--backup-keep-weekly N` | `4` |
| `--backup-no-files` | Your files and photos are included |

### Make a backup now

```bash
docker compose exec mantel-server mantel backup --target /backups
```

Run it in `packaging/compose`. Do this before every [update](Updating.md). It works even if the nightly backup is off, as long as the folder is mounted.

### Check a backup

Decrypt and check a backup without changing anything:

```bash
docker compose exec mantel-server mantel restore /backups/mantel-20261018-031500.mbk --verify-only
```

It checks the key, every part of the file, and that this version of Mantel can open the database. It ends with `verify-only: nothing was changed`. Do it once after you set backups up, and now and then afterwards.

<!-- CHECK: --verify-only unpacks into the container's /tmp, which compose.yaml limits to 64 MB; a backup with many photos may not fit. Confirm, or give the verify step a bigger scratch folder. -->

### Restore with Docker or the LXC

Mantel restores into its data volume only after it has decrypted and checked the whole backup. If any check fails, nothing changes.

1. Put the keys in place. On a rebuilt host, copy your saved `at_rest.key` and `backup.key` into `/etc/hk/secrets` (`root:10001`, mode `0440`) **before** you start.
2. Stop Mantel:

   ```bash
   docker compose stop mantel-server
   ```

3. Restore. The file path is as Mantel sees it, under `/backups`:

   ```bash
   docker compose run --rm --no-deps mantel-server restore /backups/mantel-20261018-031500.mbk --replace
   ```

   `--replace` is needed when the volume already has a database. The old files aren't deleted: they are moved aside with `.before-restore-<time>` added to their names.
4. Start Mantel again:

   ```bash
   docker compose up -d --wait
   ```

5. Sign in as the Owner and check: your screens draw, **Mantel Settings** → **Connections** shows Home Assistant connected, and the audit log's newest rows are from before the backup.

A backup from an older Mantel is brought up to date as it is restored. A backup from a **newer** Mantel is refused (`schema_too_new`): update Mantel first.

If the restore stops with an error, it names it, for example `restore failed (wrong_key)`:

| Error | Means |
|---|---|
| `key_missing`, `key_invalid` | No usable `backup.key` in `/etc/hk/secrets` |
| `wrong_key` | The file is fine, but this isn't the key it was made with |
| `corrupt`, `not_a_backup` | The file is damaged, cut short or not a Mantel backup |
| `schema_too_new` | The backup comes from a newer Mantel |
| `data_dir_not_fresh` | There is already a database: add `--replace` |
| `not_found` | No such file at that path inside the container |

### Also keep

| What | Why |
|---|---|
| `at_rest.key`, `backup.key` | Above. A copy off the machine. |
| `packaging/compose/.env` and your `compose.local.yaml` | Your settings. No secrets in them. |
| The tokens in `/etc/hk/secrets` | Optional: Cloudflare can issue new ones. |

In the LXC, a Proxmox backup of the whole container is a good second copy, but it holds the keys and the data together: store it as carefully as the keys.
