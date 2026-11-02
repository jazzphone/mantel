#!/usr/bin/env bash
# One-command update with automatic rollback (PLAN §8). Run from this folder, on the Docker host / in the LXC:
#
#   ./update.sh
#
# 1. remembers the running images as  mantel-rollback/<service>:previous  (the previous digest, kept tagged)
# 2. pulls every image .env names from a registry (MANTEL_SERVER_IMAGE=ghcr.io/jazzphone/mantel-server@sha256:...
#    and the others), and leaves the ones built here alone (the defaults, mantel-*:local)
# 3. makes a Mantel backup with the running server (`mantel backup --target /backups`) and stops if it fails:
#    a new image migrates the database when it starts, and the old image then refuses that database, so the
#    rollback below cannot undo a migration; the backup is the way back (Backups.md "Restore")
# 4. docker compose up -d --wait   (--wait fails if a service does not become healthy)
# 5. on failure: starts the remembered images again, without pulling. If they won't start either (the new
#    version migrated the database and the old image refuses it), it prints the exact restore.sh command for the
#    backup made in step 3 and exits 3. Exit status: 0 updated, 1 failed (nothing changed, or rolled back),
#    3 failed and not running: restore that backup.
# Read it before running it. It touches only this stack's containers and images.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '==> %s\n' "$*"; }

keep() {  # keep <service>: tag the image the service runs now
  local cid
  cid="$(docker compose ps -q "$1" 2>/dev/null || true)"
  [ -n "$cid" ] || return 1
  docker tag "$(docker inspect --format '{{.Image}}' "$cid")" "mantel-rollback/$1:previous"
  say "kept the running $1 image as mantel-rollback/$1:previous"
}

HAVE_SERVER=0; HAVE_GO2RTC=0; HAVE_CADDY=0
keep mantel-server && HAVE_SERVER=1 || true
keep go2rtc && HAVE_GO2RTC=1 || true
keep caddy && HAVE_CADDY=1 || true

# Not `docker compose pull --ignore-buildable`: every Mantel service also has a build: section (so the
# stack builds from source by default), and that flag skips exactly those, so a published image was never
# fetched and the "update" restarted the old one. Instead each image the resolved stack names is pulled by
# name, unless it is one this host builds: a :local tag (the defaults) or a rollback tag. A registry image
# that cannot be pulled stops the update here, before anything was restarted.
say "pulling"
images="$(docker compose config --images)"
pulled=0
for image in $images; do
  case "$image" in
    *:local|mantel-rollback/*) say "not pulling $image (built on this host: docker compose build)" ;;
    *) docker pull "$image" || { say "could not pull $image; nothing was changed"; exit 1; }
       pulled=$((pulled + 1)) ;;
  esac
done
[ "$pulled" -gt 0 ] || say "no image comes from a registry: to update a build from source, see Updating.md"
backup=""
if [ "$HAVE_SERVER" = 1 ]; then
  say "backing up before anything is restarted"
  made="$(docker compose exec -T mantel-server mantel backup --target /backups)" \
    || { say "the backup failed; nothing was restarted. Fix it (Backups.md) or make one by hand, then run this again"; exit 1; }
  printf '%s\n' "$made"
  # "backup written: /backups/<name>.mbk (N bytes)": the same file on this host, in the folder compose mounts there
  name="$(printf '%s\n' "$made" | sed -n 's#^backup written: .*/\([^/ ]*\.mbk\) (.*#\1#p' | tail -1)"
  dir="${MANTEL_BACKUP_DIR:-$(sed -n 's/^MANTEL_BACKUP_DIR=//p' .env 2>/dev/null | tail -1 || true)}"
  [ -z "$name" ] || backup="${dir:-./backups}/$name"
else
  say "mantel-server is not running: no backup to make"
fi
say "starting"
if docker compose up -d --wait --wait-timeout 180; then
  say "updated and healthy"
  exit 0
fi

say "the new version did not become healthy: rolling back"
[ "$HAVE_SERVER" = 1 ] && export MANTEL_SERVER_IMAGE="mantel-rollback/mantel-server:previous"
[ "$HAVE_GO2RTC" = 1 ] && export MANTEL_TRANSCODE_IMAGE="mantel-rollback/go2rtc:previous"
[ "$HAVE_CADDY" = 1 ] && export MANTEL_CADDY_IMAGE="mantel-rollback/caddy:previous"
if ! docker compose up -d --wait --wait-timeout 180 --pull never; then
  say "the previous version did not start either: the new one probably migrated the database, which the old image refuses (schema_too_new)"
  if [ -n "$backup" ]; then
    say "Mantel is NOT running. Restore the backup made just before this update, as root, from $PWD:"
    say "    ./restore.sh $backup"
  else
    say "Mantel is NOT running, and no backup was made by this update: restore your latest one (Backups.md \"Restore\")"
  fi
  exit 3
fi
say "rolled back; see: docker compose logs --tail 100. Fix .env's image references before the next update."
exit 1
