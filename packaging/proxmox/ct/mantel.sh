#!/usr/bin/env bash
# Mantel's scripts live in Mantel's repository (packaging/proxmox: ct/ and install/), the engine is community-scripts'
# own (community-scripts/core). Set before build.func so a copy fetched with curl finds install/mantel-install.sh here.
#
# Pinned, so what runs as root on the Proxmox host is what was read: the install script comes from the same ref as
# this script (a one-liner that names a release tag and sets var_mantel_ref to it stays on that tag; without a ref,
# or with "latest", the files come from main), and the engine from the community-scripts/core commit below. Set
# COMMUNITY_SCRIPTS_URL / COMMUNITY_SCRIPTS_CORE_URL to use others (a fork, a newer engine you have read).
_mantel_ref="${var_mantel_ref:-latest}"
if [[ "$_mantel_ref" == "latest" ]]; then _mantel_ref="main"; fi
export COMMUNITY_SCRIPTS_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/jazzphone/mantel/${_mantel_ref}/packaging/proxmox}"
export COMMUNITY_SCRIPTS_CORE_URL="${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/09fac1952f6050395aae8e6ecc9d4900c5c180d2}"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL}/core/build.func")
# Copyright (c) 2026 jazzphone
# Author: jazzphone
# License: MIT | https://github.com/jazzphone/mantel/raw/main/LICENSE
# Source: https://github.com/jazzphone/mantel

APP="Mantel"
var_tags="${var_tags:-smarthome;dashboard}"
var_cpu="${var_cpu:-4}"
var_ram="${var_ram:-6144}"
var_disk="${var_disk:-32}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_unprivileged="${var_unprivileged:-1}"
var_gpu="${var_gpu:-yes}"
# Mantel runs as a Docker Compose stack inside the container
var_nesting="${var_nesting:-1}"
var_keyctl="${var_keyctl:-1}"

# Mantel's own questions, asked inside the container unless set here (how browsers reach it: mantel-setup, which the
# install runs and which can be run again any time; try needs nothing and is the default)
export var_mantel_tls="${var_mantel_tls:-}"            # try | internal | dns01 | own
export var_mantel_domain="${var_mantel_domain:-}"      # the name browsers use, e.g. mantel.example.com
export var_mantel_dns="${var_mantel_dns:-}"            # dns01: cloudflare | duckdns | porkbun | route53 | digitalocean | desec
export var_mantel_proxy_ip="${var_mantel_proxy_ip:-}"  # own: your reverse proxy's address, as Mantel sees it
export var_mantel_connect="${var_mantel_connect:-}"    # yes: Mantel Connect's port 8766, for Home Assistant's sidebar
export var_mantel_ref="${var_mantel_ref:-}"            # latest (the newest v* tag, else main), a branch, a tag or a commit
MANTEL_DIR="${MANTEL_DIR:-/opt/mantel}"                # where the install keeps Mantel (the tests point it elsewhere)

header_info "$APP"
variables
color
catch_errors

# The commit `update` should move to: the newest v* release tag for "latest" (main while there is none), else the
# branch, tag or commit the install was pinned to (git config mantel.ref).
function mantel_target() {
  local ref="$1" tag
  if [[ "$ref" == "latest" ]]; then
    tag="$(git tag -l 'v[0-9]*' --sort=-v:refname | head -1)"
    if [[ -n "$tag" ]]; then git rev-parse "${tag}^{commit}"; else git rev-parse origin/main; fi
  else
    git rev-parse --verify -q "origin/${ref}^{commit}" || git rev-parse --verify -q "${ref}^{commit}"
  fi
}

function mantel_version() {
  sed -n 's/^version: *"\{0,1\}\([0-9][0-9A-Za-z.+-]*\)"\{0,1\} *$/\1/p' "${MANTEL_DIR}/packaging/ha-app/config.yaml" | head -1
}

# The version a commit says it is, without checking it out.
function mantel_version_at() {
  git show "$1:packaging/ha-app/config.yaml" 2>/dev/null |
    sed -n 's/^version: *"\{0,1\}\([0-9][0-9A-Za-z.+-]*\)"\{0,1\} *$/\1/p' | head -1
}

# The first image .env pins to a version of this release whose tag the registry does not have (empty when all of
# them are there, or when .env pins none: a build from source needs no published image). A tag is pushed a while
# before release.yml has published the images, and a release whose run failed never gets them.
function mantel_unpublished_image() {
  local version="$1" image
  while IFS= read -r image; do
    docker manifest inspect "${image%:*}:${version}" >/dev/null 2>&1 || { echo "${image%:*}:${version}"; return 0; }
  done < <(sed -n -E 's/^MANTEL_(SERVER|TRANSCODE|CADDY)_IMAGE=(ghcr\.io\/jazzphone\/mantel-[a-z]+:[0-9][0-9A-Za-z.+-]*)$/\2/p' \
             "${MANTEL_DIR}/packaging/compose/.env" 2>/dev/null)
  return 0
}

# The newest backup file on this host (the one update.sh made just before it started the new version).
function mantel_latest_backup() {
  local dir
  dir="$(sed -n 's/^MANTEL_BACKUP_DIR=//p' "${MANTEL_DIR}/packaging/compose/.env" 2>/dev/null | tail -1)"
  dir="${dir:-./backups}"
  [[ "$dir" == /* ]] || dir="${MANTEL_DIR}/packaging/compose/${dir#./}"
  ls -t "$dir"/*.mbk 2>/dev/null | head -1
}

function mantel_is_healthy() {
  [[ "$(docker inspect --format '{{.State.Health.Status}}' mantel-server 2>/dev/null || true)" == "healthy" ]]
}

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -d "${MANTEL_DIR}/.git" ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi
  cd "${MANTEL_DIR}"
  local ref old target from to missing rc
  ref="$(git config --get mantel.ref || echo latest)"
  msg_info "Checking for a new version (${ref})"
  $STD git fetch --tags --force --prune origin
  target="$(mantel_target "$ref")" || {
    msg_error "No such branch, tag or commit: ${ref} (git -C ${MANTEL_DIR} config mantel.ref <ref>)"
    exit 1
  }
  old="$(git rev-parse HEAD)"
  msg_ok "Checked for a new version"
  if [[ "$target" == "$old" ]]; then
    msg_ok "${APP} $(mantel_version) is up to date"
    exit
  fi
  from="$(mantel_version)"
  if git merge-base --is-ancestor "$target" "$old" 2>/dev/null; then
    # an install made from main (or a pinned branch) is past the newest tag: moving to it would be a downgrade
    if [[ "$ref" == "latest" ]]; then
      msg_ok "${APP} ${from} is ahead of the newest release ($(mantel_version_at "$target")); nothing to update"
    else
      msg_ok "${APP} ${from} is ahead of ${ref}; nothing to update"
    fi
    exit
  fi
  to="$(mantel_version_at "$target")"
  missing=""
  [[ -z "$to" ]] || missing="$(mantel_unpublished_image "$to")"
  if [[ -n "$missing" ]]; then
    # nothing was changed: not the checkout, not .env
    echo -e "${INFO:-}${YW:-}${APP} ${to} is tagged, but its image ${missing} is not published yet (a release's images follow its tag by a few minutes; a release whose run failed gets a new version). ${APP} ${from} stays; try again later.${CL:-}"
    exit
  fi
  msg_info "Updating ${APP} from ${from} (a backup first; the previous images stay for rollback; several minutes)"
  $STD git checkout --quiet --detach "$target"
  # packaging/lxc/mantel.sh update: rebuilds (or pulls this version's images), backs up, starts it and waits until
  # it is healthy, and starts the previous images again if it isn't. It puts .env's image pins back if it fails.
  rc=0
  $STD bash "${MANTEL_DIR}/packaging/lxc/mantel.sh" update || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    git checkout --quiet --detach "$old"
    if mantel_is_healthy; then
      msg_error "The update did not start healthy: ${APP} ${from} is running again (docker compose logs in ${MANTEL_DIR}/packaging/compose)"
    else
      # the new version migrated the database and the old image refuses it (schema_too_new): nothing is running
      msg_error "The update did not start healthy, and ${APP} ${from} is NOT running again (its image refuses the database the new version migrated)."
      echo -e "${INFO:-}${YW:-}Restore the backup made just before the update:  cd ${MANTEL_DIR}/packaging/compose && ./restore.sh $(mantel_latest_backup || true)${CL:-}"
      echo -e "${INFO:-}${YW:-}(docker compose logs in ${MANTEL_DIR}/packaging/compose; Backups.md \"Restore\")${CL:-}"
    fi
    exit 1
  fi
  msg_ok "Updated ${APP} to $(mantel_version)"
  mantel_commands
  msg_ok "Updated successfully!"
  exit
}

# Commands a newer release brings to a container installed before them (mantel-install.sh writes them at install):
# mantel-setup came with 0.1.114.
function mantel_commands() {
  local bin="${MANTEL_SBIN:-/usr/local/sbin}"
  if [[ -f "${MANTEL_DIR}/packaging/lxc/mantel-setup.sh" && ! -e "${bin}/mantel-setup" ]]; then
    printf '#!/usr/bin/env bash\nexec bash %s/packaging/lxc/mantel-setup.sh "$@"\n' "${MANTEL_DIR}" > "${bin}/mantel-setup"
    chmod 0750 "${bin}/mantel-setup"
    msg_ok "New command: mantel-setup (how browsers reach ${APP}: a name, your domain's certificate, your proxy)"
  fi
}

start
build_container
description

ENV_OF() { pct exec "$CTID" -- sed -n "s/^$1=//p" /opt/mantel/packaging/compose/.env 2>/dev/null | tail -1; }
HOST_NAME="$(ENV_OF MANTEL_HOSTNAME)"
RUNNING="$(pct exec "$CTID" -- docker ps -q --filter name=^mantel-server$ 2>/dev/null || true)"
msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
if [[ -n "$RUNNING" ]]; then
  CODE="$(pct exec "$CTID" -- docker exec mantel-server mantel bootstrap 2>/dev/null | sed -n '3s/^ *//p' || true)"
  echo -e "${INFO}${YW}Open it and choose \"First start\":${CL}"
  echo -e "${GATEWAY}${BGN}https://${HOST_NAME:-${IP}}/login${CL}"
  [[ -n "$CODE" ]] && echo -e "${INFO}${YW}One-time setup code (valid one hour):${CL} ${BGN}${CODE}${CL}"
  if [[ "$HOST_NAME" == "$IP" ]]; then
    echo -e "${INFO}${YW}Your browser warns about Mantel's own certificate the first time: continue to the page.${CL}"
  elif [[ "$(ENV_OF COMPOSE_FILE)" == *byo-proxy* ]]; then
    echo -e "${INFO}${YW}First point your proxy at http://${IP}:8765 (WebSockets on) and ${HOST_NAME} at your proxy; then open /proxy-check as the Owner.${CL}"
  else
    echo -e "${INFO}${YW}First point ${HOST_NAME} at ${IP} in your home's DNS.${CL}"
  fi
  echo -e "${INFO}${YW}A name, your own certificate or your proxy, any time: in the container's console, run${CL} ${BGN}mantel-setup${CL}"
  echo -e "${INFO}${YW}A new setup code: pct exec ${CTID} -- docker exec mantel-server mantel bootstrap${CL}"
else
  echo -e "${INFO}${YW}Mantel didn't start. In the container (pct enter ${CTID}): cd /opt/mantel/packaging/compose && docker compose logs --tail 50${CL}"
fi
