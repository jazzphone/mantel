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
# build cache from hotfixes built here; `docker builder prune -f` keeps no cache between hotfixes (a build is ~5 min).
set -euo pipefail
SHA="${1:?usage: mantel-hotfix.sh <full sha of a main commit>}"
SHORT="${SHA:0:9}"
INSTALL_DIR="${MANTEL_INSTALL_DIR:-/opt/mantel}"
WORK="${MANTEL_HOTFIX_DIR:-/root/hotfix}"
LOGS="${MANTEL_HOTFIX_LOGS:-/root}"           # the build and up logs, and .env as it was

prune_cache() {
  docker builder prune -f >/dev/null 2>&1 && echo "build cache pruned" || echo "build cache NOT pruned: docker builder prune -f by hand" >&2
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
docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
