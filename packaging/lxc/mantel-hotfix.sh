#!/bin/bash
# A HOTFIX ON THE HOUSE (no release), inside the LXC: build mantel-server from a commit of main, pin .env to it,
# recreate. The next release's `update` rewrites the pin to its version (mantel.sh follow_source_version).
#
#   scp -i ~/.ssh/mantel_lxc packaging/lxc/mantel-hotfix.sh root@<lxc>:/root/
#   ssh -i ~/.ssh/mantel_lxc root@<lxc> /root/mantel-hotfix.sh <full sha> </dev/null
#
# Only with the owner's OK, as any change to the house (docs/development/Releasing.md, "A hotfix on the house"). The
# image is tagged <the commit's version>-main.<sha9> and never pushed: release.yml tags images by version alone.
#
# Phase 25 (E3): every way out prunes Docker's build cache. The house's LXC was 92% full on 2026-11-11, 19.5 GB of it
# build cache from hotfixes built here. `docker builder prune -af`: all of it, so no cache is kept between hotfixes (a
# build is ~5 min). Without -a only the cache no image holds went, and every hotfix left its image: 35 of them held
# 16 GB of cache on 2026-11-15 (88% full again). So a hotfix that started also removes the hotfix images before it, by
# exact tag, all but itself and the one it replaced (the way back); `update` removes those two (mantel.sh
# old_mantel_images).
set -euo pipefail
SHA="${1:?usage: mantel-hotfix.sh <full sha of a main commit>}"
SHORT="${SHA:0:9}"
INSTALL_DIR="${MANTEL_INSTALL_DIR:-/opt/mantel}"
WORK="${MANTEL_HOTFIX_DIR:-/root/hotfix}"
LOGS="${MANTEL_HOTFIX_LOGS:-/root}"           # the build and up logs, and .env as it was

prune_cache() {
  docker builder prune -af >/dev/null 2>&1 && echo "build cache pruned" || echo "build cache NOT pruned: docker builder prune -af by hand" >&2
}
trap prune_cache EXIT

cd "$INSTALL_DIR" && git fetch -q origin
rm -rf "$WORK" && git worktree prune && git worktree add -q -f --detach "$WORK" "$SHA"
VERSION="$(sed -n 's/^version: *"\{0,1\}\([0-9][0-9A-Za-z.+-]*\)"\{0,1\} *$/\1/p' "$WORK/packaging/ha-app/config.yaml" | head -1)"
[ -n "$VERSION" ] || { echo "no version in $WORK/packaging/ha-app/config.yaml" >&2; exit 1; }
TAG="ghcr.io/jazzphone/mantel-server:${VERSION}-main.${SHORT}"
cd "$WORK"
docker build -q -f packaging/docker/Dockerfile --target server --build-arg VCS_REF="$SHA" -t "$TAG" . \
  >"$LOGS/hotfix-build.log" 2>&1 || { tail -30 "$LOGS/hotfix-build.log"; exit 1; }
echo "built $TAG"
cd "$INSTALL_DIR/packaging/compose"
cp .env "$LOGS/env.before-hotfix-${SHORT}"
sed -i.bak "s#^MANTEL_SERVER_IMAGE=.*#MANTEL_SERVER_IMAGE=${TAG}#" .env && rm -f .env.bak
grep '^MANTEL_SERVER_IMAGE=' .env
docker compose up -d >"$LOGS/hotfix-up.log" 2>&1 || {
  tail -20 "$LOGS/hotfix-up.log"
  cp "$LOGS/env.before-hotfix-${SHORT}" .env
  docker compose up -d
  exit 1
}
cd "$INSTALL_DIR" && git worktree remove --force "$WORK"
# the hotfix images before this one: never -f (an image a container still uses stays), never `docker image prune`
BEFORE="$(sed -n 's/^MANTEL_SERVER_IMAGE=//p' "$LOGS/env.before-hotfix-${SHORT}" | head -1)"
docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
  | grep -E '^ghcr\.io/jazzphone/mantel-server:[0-9][0-9A-Za-z.+-]*-main\.[0-9a-f]{9}$' \
  | grep -vxF -e "$TAG" -e "${BEFORE:-$TAG}" \
  | { n=0; while IFS= read -r ref; do docker rmi "$ref" >/dev/null 2>&1 && n=$((n + 1)); done
      echo "old hotfix images removed: $n"; } || true
docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
