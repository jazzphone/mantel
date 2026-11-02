#!/usr/bin/env bash
# Restore a Mantel backup into this stack, from this Mantel or another one (the Home Assistant App, an old
# server). Run as root from this folder, on the Docker host / in the LXC:
#
#   ./restore.sh <backup.mbk>                      # one of this Mantel's own backups
#   ./restore.sh <backup.mbk> <mantel-keys.json>   # another Mantel's: its keys file (Mantel Settings -> Backups
#                                                  #   -> Save Keys...), whose two keys become this Mantel's
#
# 1. checks the whole backup with the image's own restore --verify-only (and the keys file's backup key), changing
#    nothing: a wrong key, a damaged file or a backup from a newer Mantel stops it here
# 2. stops mantel-server
# 3. with a keys file: moves at_rest.key and backup.key aside in the secrets folder (*.before-restore-<time>) and
#    puts the keys file's in their place (root:10001 0440). Mantel can't do this itself (Settings -> Restore From
#    Another Mantel): the secrets are mounted read-only, and without the other Mantel's at-rest key the restored
#    authenticator apps and saved connections can't be opened
# 4. restores (--replace: what was in the data volume is moved aside, never deleted); on failure, and when this
#    script is interrupted (Ctrl-C, a closed terminal), the old keys go back and Mantel starts again
# 5. starts Mantel again if it was running (docker compose up -d --wait); a new install that was never started
#    is left stopped, for you to start when .env is ready
# Read it before running it. It touches only this stack's mantel-server and the two key files.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '==> %s\n' "$*"; }
die() { printf '==> %s\n' "$*" >&2; exit 1; }

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || die "usage: ./restore.sh <backup.mbk> [<mantel-keys.json>]"
[ "$(id -u)" = 0 ] || die "run it as root: it puts the keys in the secrets folder"
backup="$1"; keys="${2:-}"
[ -f "$backup" ] || die "no such backup file: $backup"
[ -z "$keys" ] || [ -f "$keys" ] || die "no such keys file: $keys"
secrets="${MANTEL_SECRETS_DIR:-$(sed -n 's/^MANTEL_SECRETS_DIR=//p' .env 2>/dev/null | tail -1)}"
secrets="${secrets:-/etc/hk/secrets}"
[ -d "$secrets" ] || die "no secrets folder at $secrets (MANTEL_SECRETS_DIR in .env)"

# the server's uid reads the copies in a private folder, mounted only into the one-off restore containers
work="$(mktemp -d /var/tmp/mantel-restore.XXXXXX)"
stamp="$(date -u +%Y%m%d-%H%M%S)"
was_running=0; stopped=0; keys_swapped=0
put_back() {
  for k in at_rest.key backup.key; do
    [ -f "$secrets/$k.before-restore-$stamp" ] && mv -f "$secrets/$k.before-restore-$stamp" "$secrets/$k"
  done
  return 0
}
cleanup() {  # on every exit, an interrupted one too: never leave the new keys beside the old data, or Mantel stopped
  local rc=$?
  trap - EXIT INT TERM
  if [ "$keys_swapped" = 1 ]; then put_back; echo "==> put the old keys back" >&2; fi
  if [ "$stopped" = 1 ] && [ "$was_running" = 1 ]; then docker compose up -d --wait --wait-timeout 180 mantel-server || true; fi
  rm -rf "$work"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$work/keys"
cp "$backup" "$work/backup.mbk"
[ -z "$keys" ] || cp "$keys" "$work/keys.json"
chown -R 10001:10001 "$work"; chmod -R go= "$work"
run() { docker compose run --rm --no-deps -T -v "$work:/restore" mantel-server restore /restore/backup.mbk "$@"; }

say "checking the backup (nothing is changed)"
if [ -n "$keys" ]; then
  run --verify-only --keys-file /restore/keys.json --write-keys /restore/keys || die "the backup did not check out; nothing was changed"
else
  run --verify-only || die "the backup did not check out; nothing was changed"
fi

[ -n "$(docker compose ps -q --status running mantel-server 2>/dev/null)" ] && was_running=1
say "stopping mantel-server"
stopped=1
docker compose stop mantel-server

if [ -n "$keys" ]; then
  say "putting the keys file's keys in $secrets (the old ones are kept as *.before-restore-$stamp)"
  keys_swapped=1
  for k in at_rest.key backup.key; do
    [ -f "$secrets/$k" ] && mv "$secrets/$k" "$secrets/$k.before-restore-$stamp"
    install -o root -g 10001 -m 0440 "$work/keys/$k" "$secrets/$k"
  done
fi

say "restoring"
if ! run --replace; then
  [ -z "$keys" ] || { put_back; keys_swapped=0; say "put the old keys back"; }
  [ "$was_running" = 0 ] || docker compose up -d --wait --wait-timeout 180 mantel-server || true
  stopped=0
  die "the restore failed; the data was not changed"
fi
keys_swapped=0; stopped=0         # the data and the keys now belong together: an interrupt from here puts nothing back

if [ "$was_running" = 1 ]; then
  say "starting Mantel"
  # recreated, so the container mounts the key files just put in place
  docker compose up -d --wait --wait-timeout 180 --force-recreate mantel-server
  say "restored and running"
else
  say "restored. Start Mantel when .env is ready: docker compose up -d --wait"
fi
[ -z "$keys" ] || say "this Mantel now uses the keys in that keys file: keep it with your backups' keys, off this machine"
say "from the Home Assistant App? Sign in as the Owner and connect Home Assistant: Mantel Settings -> Connections"
