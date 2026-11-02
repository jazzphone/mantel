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

# Mantel's questions: each one is skipped when its var_mantel_* is set (ct/mantel.sh exports them)
TLS="${var_mantel_tls:-}"
if [[ -z "$TLS" ]]; then
  echo -e "${TAB3}How should browsers reach Mantel over HTTPS?"
  echo -e "${TAB3}  internal  Mantel's Caddy with its own certificate authority (no domain; trust it once on each device)"
  echo -e "${TAB3}  dns01     Mantel's Caddy with your own domain and a real certificate (your DNS host's API)"
  echo -e "${TAB3}  own       Your own reverse proxy owns HTTPS (Nginx Proxy Manager, Traefik, ...)"
  read -r -p "${TAB3}internal, dns01 or own [internal]: " TLS || true
fi
TLS="${TLS:-internal}"
case "$TLS" in internal | dns01 | own) ;; *) msg_error "var_mantel_tls must be internal, dns01 or own"; exit 64 ;; esac

DNS="${var_mantel_dns:-}"
if [[ "$TLS" == "dns01" && -z "$DNS" ]]; then
  read -r -p "${TAB3}Your DNS host: cloudflare, duckdns, porkbun, route53, digitalocean or desec [cloudflare]: " DNS || true
fi
DNS="${DNS:-cloudflare}"
case "$DNS" in cloudflare | duckdns | porkbun | route53 | digitalocean | desec) ;; *) msg_error "var_mantel_dns: unknown DNS host ${DNS}"; exit 64 ;; esac

DOMAIN="${var_mantel_domain:-}"
if [[ -z "$DOMAIN" ]]; then
  if [[ "$TLS" == "dns01" ]]; then
    read -r -p "${TAB3}The name browsers will use (e.g. mantel.example.com): " DOMAIN || true
  else
    read -r -p "${TAB3}The name browsers will use (e.g. mantel.example.com) [mantel.home.arpa]: " DOMAIN || true
    DOMAIN="${DOMAIN:-mantel.home.arpa}"
  fi
fi
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ ]] || { msg_error "Not a host name: '${DOMAIN}' (var_mantel_domain)"; exit 64; }

PROXY_IP="${var_mantel_proxy_ip:-}"
if [[ "$TLS" == "own" && -z "$PROXY_IP" ]]; then
  read -r -p "${TAB3}Your proxy's IP address, as Mantel will see it (Enter to set it later): " PROXY_IP || true
fi
[[ -z "$PROXY_IP" || "$PROXY_IP" =~ ^[0-9A-Fa-f:.]+$ ]] || { msg_error "var_mantel_proxy_ip must be an IP address"; exit 64; }

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
# backup keys, the settings file, mantel-secret and mantel-update, and this version's published images (built here
# when they aren't published)
msg_info "Installing Mantel (Docker, keys, settings and images; building them takes several minutes)"
if [[ "${ENABLE_GPU:-${var_gpu:-no}}" == "yes" && -c /dev/dri/renderD128 ]]; then GPU=yes; else GPU=no; fi
MANTEL_INSTALL_MODE="auto" MANTEL_GPU="$GPU" MANTEL_CONNECT="$CONNECT" MANTEL_TLS="$TLS" MANTEL_DNS="$DNS" \
  MANTEL_DOMAIN="$DOMAIN" MANTEL_PROXY_IP="$PROXY_IP" MANTEL_TUNNEL="no" \
  bash /opt/mantel/packaging/lxc/mantel-install.sh >/root/mantel-next-steps.txt 2>&1 || {
  cat /root/mantel-next-steps.txt
  msg_error "Mantel's installer failed (above; also in /root/mantel-next-steps.txt)"
  exit 1
}
# keep only its closing instructions
sed -i -n '/^Installed\. Mantel is NOT running yet/,$p' /root/mantel-next-steps.txt
msg_ok "Installed Mantel"

# Started now unless it still needs something only you have: the DNS host's token (dns01) or the proxy's address (own)
if [[ "$TLS" == "internal" || ("$TLS" == "own" && -n "$PROXY_IP") ]]; then
  msg_info "Starting Mantel"
  cd /opt/mantel/packaging/compose
  $STD docker compose up -d --wait --wait-timeout 300
  msg_ok "Started Mantel"
fi

motd_ssh
customize
cleanup_lxc
