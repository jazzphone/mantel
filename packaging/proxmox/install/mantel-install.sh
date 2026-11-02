#!/usr/bin/env bash

# Copyright (c) 2026 jazzphone
# Author: jazzphone
# License: MIT | https://github.com/jazzphone/mantel/raw/main/LICENSE
# Source: https://github.com/jazzphone/mantel

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt install -y git
msg_ok "Installed Dependencies"

# How browsers reach Mantel is asked after the install, by mantel-setup (packaging/lxc/mantel-setup.sh), whose first
# choice needs nothing: https://<this container's address> with Mantel's own certificate. So Mantel always comes up,
# and the rest (a name, your domain's token, your proxy) can be given now, or later with `mantel-setup`.
CONNECT="${var_mantel_connect:-}"
if [[ -z "$CONNECT" ]]; then
  read -r -p "${TAB3}Show Mantel in Home Assistant's sidebar too, through Mantel Connect? [y/N]: " CONNECT || true
fi
case "${CONNECT,,}" in y | yes) CONNECT=yes ;; *) CONNECT=no ;; esac

REF="${var_mantel_ref:-latest}"

# A branch of the clone exists only as origin/<branch> (the clone made one local branch, main), so a bare branch
# name does not check out; a tag or a commit does.
mantel_checkout() {  # mantel_checkout REF
  git checkout --quiet --detach "origin/$1" >/dev/null 2>&1 || git checkout --quiet --detach "$1" >/dev/null 2>&1
}

msg_info "Fetching Mantel"
$STD git clone --filter=blob:none https://github.com/jazzphone/mantel.git /opt/mantel
cd /opt/mantel
git config mantel.ref "$REF"
if [[ "$REF" == "latest" ]]; then
  TAG="$(git tag -l 'v[0-9]*' --sort=-v:refname | head -1)"
  [[ -z "$TAG" ]] || $STD git checkout --quiet --detach "$TAG"
else
  mantel_checkout "$REF" || { msg_error "No such branch, tag or commit: ${REF} (var_mantel_ref)"; exit 64; }
fi
VERSION="$(sed -n 's/^version: *"\{0,1\}\([0-9][0-9A-Za-z.+-]*\)"\{0,1\} *$/\1/p' packaging/ha-app/config.yaml | head -1)"
msg_ok "Fetched Mantel ${VERSION} ($(git rev-parse --short HEAD))"

# The same installer as packaging/lxc/mantel.sh: Docker, the secrets folder (/etc/hk/secrets) with the at-rest and
# backup keys, the settings file, mantel-secret, mantel-setup and mantel-update, and this version's published images
# (built here when they aren't published). It starts from "try": this container's address, Mantel's own certificate.
msg_info "Installing Mantel (Docker, keys, settings and images; building them takes several minutes)"
if [[ "${ENABLE_GPU:-${var_gpu:-no}}" == "yes" && -c /dev/dri/renderD128 ]]; then GPU=yes; else GPU=no; fi
LAN_IP="$(hostname -I | awk '{print $1}')"
MANTEL_INSTALL_MODE="auto" MANTEL_GPU="$GPU" MANTEL_CONNECT="$CONNECT" MANTEL_TLS="internal" MANTEL_DNS="cloudflare" \
  MANTEL_DOMAIN="$LAN_IP" MANTEL_PROXY_IP="" MANTEL_TUNNEL="no" MANTEL_STARTS_IT="yes" \
  bash /opt/mantel/packaging/lxc/mantel-install.sh >/root/mantel-install.log 2>&1 || {
  cat /root/mantel-install.log
  msg_error "Mantel's installer failed (above; also in /root/mantel-install.log)"
  exit 1
}
msg_ok "Installed Mantel"

# How browsers reach it (var_mantel_tls / _domain / _dns / _proxy_ip answer ahead; a DNS token is typed, hidden).
# Enter takes "try"; a missing token or proxy address stays on "try" until `mantel-setup` is run again.
MANTEL_TLS="${var_mantel_tls:-}" MANTEL_DOMAIN="${var_mantel_domain:-}" MANTEL_DNS="${var_mantel_dns:-}" \
  MANTEL_PROXY_IP="${var_mantel_proxy_ip:-}" bash /opt/mantel/packaging/lxc/mantel-setup.sh --install

msg_info "Starting Mantel"
cd /opt/mantel/packaging/compose
$STD docker compose up -d --wait --wait-timeout 300
msg_ok "Started Mantel"

motd_ssh
customize
cleanup_lxc
