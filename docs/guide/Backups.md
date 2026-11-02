# Backups

Everything Mantel knows lives in its data folder: people, roles and grants, wall tablets, sessions, settings with their history, the audit log, your uploaded files and photos, and the saved connections to Home Assistant and Music Assistant. In the Home Assistant App, Home Assistant's own backups include it. With Docker or the LXC, Mantel makes its own **encrypted backup every night** to a folder you choose, and checks every backup before it restores it. On every install, **Mantel Settings** → **Backups** makes a backup when you ask, lets you download it, saves the keys, and restores one. Either way, two keys matter as much as the backups themselves.

## The two keys

Mantel seals some values in its database with the **at-rest key** (`at_rest.key`): authenticator app secrets, device keys and the saved connections. With Docker or the LXC, the backups are encrypted with a separate **backup key** (`backup.key`). The two are kept apart on purpose, so a stolen backup can't be opened with what sits on the server alone, and the other way round.

| Key | Without it |
|---|---|
| `at_rest.key` | A restored database loses every authenticator app and the saved connections: people set up their authenticator again, and you connect Home Assistant again. |
| `backup.key` | A backup can't be opened at all. |

**Keep a copy of both somewhere that is not the Mantel machine**, for example in your password manager. **Mantel Settings** → **Backups** → **Save Keys…** saves both as one small file, `mantel-keys.json` (the Owner only, after **Confirm It Is You**; the audit log records it). With Docker or the LXC they are also in `/etc/hk/secrets`. A backup can be restored only with the `backup.key` it was made with.

## In Mantel Settings

**Mantel Settings** → **Backups** is for Owners and Admins; only the Owner makes, downloads, deletes and restores backups.

- **Latest** shows when the last backup was made, whether it ran every night, and where backups are kept. **Back Up Now** makes one at once.
- **Saved Backups** lists them, newest first, each with **Download** and **Delete**. A downloaded backup is still encrypted: it needs the backup key to open.
- **Save Keys…** saves the backup key and the at-rest key as `mantel-keys.json`. Keep it apart from the backups.
- **Restore From a Backup…** uploads a `.mbk` file and checks it first: it is opened, its database checked and brought up to this version of Mantel, without changing anything. You see when it was made and what it holds. **Restore and Restart…** then puts it in place: Mantel restarts, puts the backup in place before it opens its database, and starts again. Screens and wall tablets reconnect by themselves. What was there before is moved aside in the data folder (`*.before-restore-<time>`), never deleted, and the result is in the audit log and at the top of the page.
- **Restore From Another Mantel…** does the same with a backup made elsewhere: choose that Mantel's keys file first, then the backup. Its at-rest key replaces this Mantel's (the old one is kept aside), so the restored authenticator codes and connections keep working. With Docker or the LXC, Mantel can't change its own keys (they are read-only in `/etc/hk/secrets`), so it refuses here: restore another Mantel's backup on the machine instead, with `restore.sh` ([below](#restore-with-docker-or-the-lxc)).

With no backup folder set (the Home Assistant App, or Docker before you give it one), **Back Up Now** writes to a `backups` folder in Mantel's data and nothing runs at night. The App leaves that folder out of Home Assistant's backups, which already hold everything in it.

## In the Home Assistant App

The App keeps its data in its own `/data` folder, and **Home Assistant's backups include it**: the database, the at-rest key (in `/data/secrets`), your files and photos, and, with built-in HTTPS, the certificate's key. There is no separate Mantel backup to set up.

- Make sure your Home Assistant backups run (**Settings** → **System** → **Backups**), and keep a copy off the machine.
- Protect them. A Home Assistant backup holds Mantel's at-rest key next to its database, plus password hashes and the audit log. Keep backups encrypted, and the encryption key somewhere safe.
- While Home Assistant backs the App up, it stops Mantel and starts it again straight after, so the copy of Mantel's database is exact. Mantel is away for that time (longer with many photos); the sidebar page and wall tablets come back when it does.
- To get Mantel back, restore the App from a Home Assistant backup (all of it, or just the **Mantel** App).

## With Docker or the LXC

### Turn on the nightly backup

With Docker the nightly backup is off until you give it a folder (a new LXC install already has one). Ideally that folder is on another machine, such as a NAS mounted on the Docker host.

1. Pick the host folder and make it writable by Mantel's user (uid 10001):

   ```bash
   install -d -m 0750 -o 10001 -g 10001 /mnt/nas/mantel
   ```

   The LXC script already made `/opt/mantel/packaging/compose/backups` this way, and set `MANTEL_BACKUP_TARGET=/backups` in its `.env`, so on a new LXC the nightly backup is on and writes there (point `MANTEL_BACKUP_DIR` at a NAS mount to keep the copies off the machine).
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
| The database | A consistent snapshot, safe to make while Mantel runs, checked before it is packed. It holds Mantel Settings' **General** too: a restore brings back **Allow Control of the House** as it was in the backup, so check it after restoring another Mantel's backup |
| Your files and Mantel Photos | Apple's font and glyphs you uploaded, and the screensavers' photos |
| The saved connections | Home Assistant's and Music Assistant's, still sealed with `at_rest.key` |
| [Mantel Connect](Mantel-Connect.md)'s certificates | Its own certificate authority and keys, so a paired Connect App keeps working after a restore |
| The keys Mantel makes | The push key and the apps' identity key (`keys/`), so browsers keep their notifications and the iPhone and Mac apps their pairing after a restore |

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

Run it in `packaging/compose`. Do this before every [update](Updating.md). It works even if the nightly backup is off, as long as the folder is mounted. It deletes no older backup; the nightly backup thins the folder as you set it. To thin it now as well, add `--keep-daily N` and `--keep-weekly N`.

A backup or restore that was stopped partway (the container killed, out of memory) can leave a hidden `.backup-work-*` or `.restore-*` folder in the data volume, holding an unencrypted copy of the database. The next backup or restore removes any older than six hours.

### Check a backup

Decrypt and check a backup without changing anything:

```bash
docker compose exec mantel-server mantel restore /backups/mantel-20261018-031500.mbk --verify-only
```

It checks the key, every part of the file, and that this version of Mantel can open the database. It ends with `verify-only: nothing was changed`. It unpacks the backup into a hidden folder in Mantel's data volume and removes it afterwards, so it needs free space there of about twice the backup's size while it runs. Do it once after you set backups up, and now and then afterwards.

### Restore with Docker or the LXC

Mantel restores into its data volume only after it has decrypted and checked the whole backup. If any check fails, nothing changes.

**With `restore.sh`.** As root, in `packaging/compose`:

```bash
./restore.sh /path/to/mantel-20261018-031500.mbk                     # one of this Mantel's own backups
./restore.sh /path/to/mantel-20261018-031500.mbk mantel-keys.json    # another Mantel's, with its keys file
```

It checks the whole backup first (with the keys file's backup key, for another Mantel's) and stops there, changing nothing, if it doesn't check out. Then it stops Mantel, puts the keys file's two keys in `/etc/hk/secrets` (the old ones are kept as `*.before-restore-<time>`; that keys file is then this Mantel's, so keep it), restores, and starts Mantel again if it was running. If the restore fails, the old keys go back. In the LXC you can run it from the Proxmox host instead, which copies the files in for you: `bash packaging/lxc/mantel.sh restore <id> <backup> [<keys file>]`.

**By hand:**

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
