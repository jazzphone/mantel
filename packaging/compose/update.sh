#!/usr/bin/env bash
# One-command update with automatic rollback (PLAN §8). Run from this folder, on the Docker host / in the LXC:
#
#   ./update.sh
#
# 1. remembers the running images as  mantel-rollback/<service>:previous  (the previous digest, kept tagged)
# 2. docker compose pull
# 3. docker compose up -d --wait   (--wait fails if a service does not become healthy)
# 4. on failure: starts the remembered images again, without pulling.
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

HAVE_SERVER=0; HAVE_GO2RTC=0
keep mantel-server && HAVE_SERVER=1 || true
keep go2rtc && HAVE_GO2RTC=1 || true

say "pulling"
docker compose pull --ignore-buildable
say "starting"
if docker compose up -d --wait --wait-timeout 180; then
  say "updated and healthy"
  exit 0
fi

say "the new version did not become healthy: rolling back"
[ "$HAVE_SERVER" = 1 ] && export MANTEL_SERVER_IMAGE="mantel-rollback/mantel-server:previous"
[ "$HAVE_GO2RTC" = 1 ] && export MANTEL_TRANSCODE_IMAGE="mantel-rollback/go2rtc:previous"
docker compose up -d --wait --wait-timeout 180 --pull never
say "rolled back; see: docker compose logs --tail 100. Fix .env's image references before the next update."
exit 1
