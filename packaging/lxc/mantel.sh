#!/usr/bin/env bash
# Mantel Server: Proxmox LXC installer, in the community-scripts/ProxmoxVE layout (PLAN §7, §8).
#
#   header, var_* defaults, variables, update_script, start, build_container, description
#
# READ THIS FILE BEFORE YOU RUN IT. It runs as root on the Proxmox host. Check it into your own
# review habit: run it from a checkout pinned to a release tag you have read, never from a pipe.
#
#   Create (on the Proxmox host, as root, from the repository root):
#       bash packaging/lxc/mantel.sh
#   Update, registry images (inside the container, as root; the installer put a copy there):
#       mantel-update              # = bash /opt/mantel/packaging/lxc/mantel.sh update
#   Update, build mode (on the Proxmox host, from a newer checkout; runs mantel-update inside):
#       bash packaging/lxc/mantel.sh push <ctid>
#
# What create does, and nothing else:
#   1. checks the host (root, Proxmox, x86_64) and shows a summary; asks before it changes anything
#   2. downloads the Debian 13 LXC template if missing
#   3. creates ONE container: UNPRIVILEGED (var_unprivileged=1; never privileged), nesting+keyctl for
#      Docker, not started at boot until you say so, tagged "mantel"
#   4. with var_gpu=yes and /dev/dri/renderD128 present: shares that render node in (the iGPU stays
#      shared with the host, not taken away) and tells the container its render group id
#   5. pushes packaging/ + the app source into /opt/mantel, then runs mantel-install.sh inside
#      (Docker, Compose, secret folder, .env, this version's published images or an image build, unattended
#      security upgrades; it does NOT start Mantel)
# It touches no other container or VM, changes no host setting, edits no firewall, opens no port.
#
# Why this is not "source build.func": community-scripts' build_container downloads the in-container
# install script from ITS OWN repository (install/<app>-install.sh at a fixed URL), so a script that
# lives in our repo cannot use it unmodified. This file keeps their layout, variable names and
# conventions (so it can be proposed upstream or ported to build.func later) but does the same work
# directly with pct, the way packaging/lxc/proof4/create-lxc.sh already did on proxmox1.
#
# Settings (all optional; each var_x may be set in the environment to skip its question):
#   var_cpu=4 var_ram=6144 var_disk=32 var_os=debian var_version=13 var_unprivileged=1 var_gpu=yes
#   var_ctid=<id> var_hostname=mantel var_brg=<bridge> var_vlan=<tag|none> var_storage=<rootdir storage>
#   var_template_storage=<vztmpl storage> var_install_mode=auto|pull|build
#   var_connect=no|yes   (yes: also publish Mantel Connect's port 8766, so the Connect App in Home Assistant's
#   sidebar can be paired: docs/phase3/CONNECT.md. Default no)
#   var_tls=internal|dns01|own   HTTPS (docs/OPERATIONS.md "HTTPS: four ways"): Mantel's Caddy with its own CA
#       (no domain), Mantel's Caddy with your domain (DNS-01 through your DNS host's API), or your own reverse
#       proxy (Nginx Proxy Manager, Traefik, ...; then var_proxy_ip= its address as Mantel sees it). Asked when
#       unset and there is a terminal; without one (no answer) it is internal.
#   var_dns=cloudflare|duckdns|porkbun|route53|digitalocean|desec   dns01's DNS host (asked; default cloudflare)
#   var_domain=<the name browsers use, e.g. mantel.example.com>   var_tunnel=no|yes (Cloudflare tunnel too)
#   (tokens are never asked here: after the install, mantel-secret <name>, which the install's last words list)
#   (auto = pull this version's published images from ghcr.io/jazzphone when they exist, else build them;
#    pull = only pull; build = build the images in the container from the pushed source)
set -euo pipefail

APP="Mantel"
var_tags="${var_tags:-mantel}"
var_cpu="${var_cpu:-4}"
var_ram="${var_ram:-6144}"
var_disk="${var_disk:-32}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_unprivileged="${var_unprivileged:-1}"
var_gpu="${var_gpu:-yes}"
var_connect="${var_connect:-no}"
var_tls="${var_tls:-}"
var_dns="${var_dns:-}"
var_domain="${var_domain:-}"
var_proxy_ip="${var_proxy_ip:-}"
var_tunnel="${var_tunnel:-}"
var_hostname="${var_hostname:-mantel}"
var_install_mode="${var_install_mode:-auto}"
var_ctid="${var_ctid:-}"
var_brg="${var_brg:-}"
var_vlan="${var_vlan:-}"
var_storage="${var_storage:-}"
var_template_storage="${var_template_storage:-}"

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
INSTALL_DIR="/opt/mantel"

msg_info()  { printf '\n==> %s\n' "$*"; }
msg_ok()    { printf '    ok: %s\n' "$*"; }
msg_error() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

variables() {
  [ "$var_unprivileged" = "1" ] || msg_error "var_unprivileged must stay 1: Mantel never runs in a privileged container (PLAN §7)"
  [ "$var_os" = "debian" ] && [ "$var_version" = "13" ] || msg_error "only Debian 13 is supported (var_os=debian var_version=13)"
  case "$var_gpu" in yes|no) ;; *) msg_error "var_gpu must be yes or no" ;; esac
  case "$var_connect" in yes|no) ;; *) msg_error "var_connect must be yes or no" ;; esac
  case "$var_install_mode" in auto|pull|build) ;; *) msg_error "var_install_mode must be auto, pull or build" ;; esac
  case "$var_tls" in ""|dns01|internal|own) ;; *) msg_error "var_tls must be internal, dns01 or own" ;; esac
  case "$var_dns" in ""|cloudflare|duckdns|porkbun|route53|digitalocean|desec) ;;
    *) msg_error "var_dns must be cloudflare, duckdns, porkbun, route53, digitalocean or desec" ;; esac
  case "$var_tunnel" in ""|yes|no) ;; *) msg_error "var_tunnel must be yes or no" ;; esac
}

interactive() { [ -t 0 ]; }   # a person at a terminal answers; otherwise the defaults below hold

ask_tls() {  # the HTTPS choice (docs/OPERATIONS.md "HTTPS: four ways"); every answer can be preset as var_*
  if [ -z "$var_tls" ]; then
    if interactive; then
      choose var_tls "How should browsers reach Mantel over HTTPS?" \
        "internal  Mantel's Caddy with its own certificate authority (no domain needed; trust it once on each device)" \
        "dns01     Mantel's Caddy with your own domain and a real certificate (your DNS host's API; no open port)" \
        "own       My own reverse proxy owns HTTPS (Nginx Proxy Manager, Traefik, ...)"
    else
      var_tls=internal
      echo "No terminal to ask: HTTPS with Caddy's own certificate authority (preset var_tls= to choose another)."
    fi
  fi
  if [ "$var_tls" = "dns01" ] && [ -z "$var_dns" ]; then
    if interactive; then
      choose var_dns "Which DNS host serves your domain? (Caddy proves the name there; the token comes after the install)" \
        "cloudflare    Cloudflare (an API token: Zone / DNS / Edit for that zone)" \
        "duckdns       Duck DNS (a <name>.duckdns.org name; your Duck DNS token)" \
        "porkbun       Porkbun (an API key and secret, API access on for the domain)" \
        "route53       Amazon Route 53 (an IAM access key limited to the hosted zone)" \
        "digitalocean  DigitalOcean (an API token with the domain scopes)" \
        "desec         deSEC (a deSEC token)"
    else
      var_dns=cloudflare
    fi
  fi
  [ "$var_tls" = "dns01" ] || var_dns=""
  if [ -z "$var_domain" ]; then
    local hint="mantel.example.com" fallback="mantel.home.arpa"
    [ "$var_dns" = "duckdns" ] && hint="<name>.duckdns.org"
    [ "$var_tls" = "dns01" ] && fallback=""          # a certificate needs your real domain
    if interactive; then
      read -r -p $'\nThe name browsers will use (e.g. '"$hint"${fallback:+$'; Enter for '"$fallback"}'): ' var_domain
    fi
    var_domain="${var_domain:-$fallback}"
    [ -n "$var_domain" ] || msg_error "your own domain needs its name: set var_domain= (e.g. $hint)"
  fi
  [[ "$var_domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ ]] || msg_error "not a host name: $var_domain"
  if [ "$var_dns" = "duckdns" ] && [[ ! "${var_domain,,}" =~ \.duckdns\.org$ ]]; then
    msg_error "with Duck DNS the name must be your <name>.duckdns.org, not $var_domain"
  fi
  if [ "$var_tls" = "own" ] && [ -z "$var_proxy_ip" ] && interactive; then
    read -r -p $'\nYour proxy\'s IP address, as Mantel will see it (Enter if you do not know yet): ' var_proxy_ip
  fi
  [ -z "$var_proxy_ip" ] || [[ "$var_proxy_ip" =~ ^[0-9A-Fa-f:.]+$ ]] || msg_error "var_proxy_ip must be an IP address"
  if [ -z "$var_tunnel" ]; then
    if interactive; then read -r -p $'\nAlso reach Mantel from outside through a Cloudflare tunnel? [y/N] ' var_tunnel; fi
    case "${var_tunnel,,}" in y|yes) var_tunnel=yes ;; *) var_tunnel=no ;; esac
  fi
}

# --- update: runs INSIDE the container -------------------------------------------------------------------
source_version() {  # source_version CONFIG_YAML: the version the published images of this source are tagged with
  sed -n 's/^version: *"\{0,1\}\([0-9][0-9A-Za-z.+-]*\)"\{0,1\} *$/\1/p' "$1" | head -1
}
follow_source_version() {  # follow_source_version ENV_FILE CONFIG_YAML
  # Images pinned to a version (the install's auto/pull mode) follow the source's version, which a push from
  # a newer checkout just brought, so the compose files and the images stay one release. :latest, a digest
  # or another registry's image is left as it is.
  local version
  version="$(source_version "$2")"
  [ -n "$version" ] || return 0
  sed -i -E "s#^(MANTEL_(SERVER|TRANSCODE|CADDY)_IMAGE=ghcr\.io/jazzphone/mantel-[a-z]+):[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*\$#\1:${version}#" "$1"
}

update_script() {
  [ -d "$INSTALL_DIR/packaging/compose" ] || msg_error "no Mantel installation found in $INSTALL_DIR"
  msg_info "Updating Mantel (the previous images stay tagged for automatic rollback)"
  cd "$INSTALL_DIR/packaging/compose"
  if [ "$(grep -c '^MANTEL_SERVER_IMAGE=ghcr' .env 2>/dev/null || true)" -gt 0 ]; then
    follow_source_version .env "$INSTALL_DIR/packaging/ha-app/config.yaml"
    bash ./update.sh                       # registry images: pull, up --wait, roll back on failure
  else
    # build mode: new source arrives from the Proxmox host (bash packaging/lxc/mantel.sh push <ctid>),
    # so here we rebuild what was pushed and restart, keeping the previous images for rollback.
    for s in mantel-server go2rtc; do
      cid="$(docker compose ps -q "$s" 2>/dev/null || true)"
      [ -n "$cid" ] && docker tag "$(docker inspect --format '{{.Image}}' "$cid")" "mantel-rollback/$s:previous"
    done
    docker compose build --pull
    # a backup first, as update.sh makes: the new image migrates the database, which the rollback can't undo
    if [ -n "$(docker compose ps -q mantel-server 2>/dev/null || true)" ]; then
      docker compose exec -T mantel-server mantel backup --target /backups \
        || msg_error "the backup failed; nothing was restarted. Fix it (Backups.md) or make one by hand, then run this again"
    fi
    docker compose up -d --wait --wait-timeout 180 || {
      msg_info "not healthy: rolling back"
      MANTEL_SERVER_IMAGE=mantel-rollback/mantel-server:previous MANTEL_TRANSCODE_IMAGE=mantel-rollback/go2rtc:previous \
        docker compose up -d --wait --wait-timeout 180 --pull never
      exit 1
    }
  fi
  msg_ok "updated"
  exit 0
}

if [ "${1:-}" = "update" ]; then
  [ -x "$(command -v pct)" ] && msg_error "'update' runs inside the container (mantel-update), not on the Proxmox host"
  variables; update_script
fi

# --- create: runs on the PROXMOX HOST ---------------------------------------------------------------------
start() {
  [ "$(id -u)" -eq 0 ] || msg_error "run as root on the Proxmox host"
  command -v pct >/dev/null && command -v pveam >/dev/null || msg_error "pct/pveam not found: is this a Proxmox host?"
  [ "$(uname -m)" = "x86_64" ] || msg_error "x86_64 only (the QuickSync driver); found $(uname -m)"
  for f in packaging/lxc/mantel-install.sh packaging/compose/compose.yaml packaging/docker/Dockerfile web/home.html; do
    [ -f "$REPO_ROOT/$f" ] || msg_error "run this from a complete checkout: $f is missing"
  done
  if [ "$var_gpu" = "yes" ] && [ ! -c /dev/dri/renderD128 ]; then
    echo "Note: /dev/dri/renderD128 is not on this host; continuing WITHOUT the GPU (Live TV will use the CPU)."
    var_gpu="no"
  fi
}

choose() {  # choose VAR "question" option... : numbered menu; Enter takes the first
  local var="$1" q="$2"; shift 2
  local opts=("$@") i pick
  [ "${#opts[@]}" -gt 0 ] || msg_error "no valid choices for: $q"
  printf '\n%s\n' "$q"
  for i in "${!opts[@]}"; do printf '  %d) %s\n' "$((i + 1))" "${opts[$i]}"; done
  while :; do
    read -r -p "Choose 1-${#opts[@]} [1]: " pick
    pick="${pick:-1}"
    if [[ "$pick" =~ ^[0-9]+$ ]] && [ "$pick" -ge 1 ] && [ "$pick" -le "${#opts[@]}" ]; then
      printf -v "$var" '%s' "$(awk '{print $1}' <<<"${opts[$((pick - 1))]}")"; return
    fi
    echo "  Please type a number from the list."
  done
}
storages_for() {
  pvesm status --content "$1" 2>/dev/null | awk 'NR > 1 && $3 == "active" { printf "%-22s %-8s %7.0f GB free\n", $1, $2, $6 / 1048576 }'
}

push_source() {  # push_source CTID: copy this checkout's source into the container's /opt/mantel
  local ctid="$1" tarball
  msg_info "Copying the source into ${INSTALL_DIR} (.git, docs, tests, local data and anything secret-named are excluded)"
  tarball="$(mktemp /tmp/mantel-src.XXXXXX.tar.gz)"
  ( cd "$REPO_ROOT" && tar --exclude-vcs --exclude='./.claude' --exclude='./docs' --exclude='./tests' --exclude='./spikes' \
      --exclude='./.venv' --exclude='*.pyc' --exclude='__pycache__' --exclude='.env' --exclude='*.key' --exclude='*.pem' \
      --exclude='./packaging/lxc/proof4' --exclude='./packaging/mantel-connect' -czf "$tarball" . )
  pct push "$ctid" "$tarball" /root/mantel-src.tar.gz
  rm -f "$tarball"
  # .env is the installation's own file and is excluded above, so a push never overwrites it. Extracting over the
  # old tree would keep what the new version deleted or renamed (a renamed migration leaves two files with one
  # number, and the server then refuses to start), so the CODE trees are removed first (once the tarball has been
  # read through): never packaging/compose (its .env and backups/), never the data or the secrets, which live
  # elsewhere (the Docker volume, /etc/hk/secrets).
  local trees="hosts hk_core web apple tools packaging/docker packaging/ha-app packaging/lxc packaging/connect-app packaging/push-relay"
  pct exec "$ctid" -- bash -c "mkdir -p ${INSTALL_DIR} && tar -tzf /root/mantel-src.tar.gz >/dev/null && cd ${INSTALL_DIR} && rm -rf ${trees} && tar -xzf /root/mantel-src.tar.gz -C ${INSTALL_DIR} && rm /root/mantel-src.tar.gz"
}

build_container() {
  local OPTS
  if [ -z "$var_storage" ]; then
    mapfile -t OPTS < <(storages_for rootdir); choose var_storage "Where should the container's ${var_disk} GB disk go?" "${OPTS[@]}"
  fi
  pvesm status --storage "$var_storage" >/dev/null 2>&1 || msg_error "storage '$var_storage' not found (pvesm status)"
  if [ -z "$var_template_storage" ]; then
    mapfile -t OPTS < <(storages_for vztmpl); choose var_template_storage "Where should the Debian 13 template be kept?" "${OPTS[@]}"
  fi
  pvesm status --storage "$var_template_storage" >/dev/null 2>&1 || msg_error "template storage '$var_template_storage' not found"
  if [ -z "$var_brg" ]; then
    mapfile -t OPTS < <(for b in $(ip -br link | awk '$1 ~ /^vmbr/ {print $1}'); do
      printf "%-8s %s\n" "$b" "$(ip -br -4 addr show "$b" | awk '{print ($3 ? "host address " $3 : "no host address")}')"; done)
    choose var_brg "Which bridge? It must reach Home Assistant, the HDHomeRun and your tablets." "${OPTS[@]}"
  fi
  ip link show "$var_brg" >/dev/null 2>&1 || msg_error "bridge '$var_brg' not found (ip -br link)"
  if [ -z "$var_vlan" ]; then read -r -p $'\nVLAN tag for the container (Enter for none): ' var_vlan; fi
  [ "$var_vlan" = "none" ] && var_vlan=""
  [ -z "$var_vlan" ] || [[ "$var_vlan" =~ ^[0-9]+$ ]] || msg_error "VLAN must be a number"
  var_ctid="${var_ctid:-$(pvesh get /cluster/nextid)}"
  pct status "$var_ctid" >/dev/null 2>&1 && msg_error "container $var_ctid already exists; set var_ctid= to a free id"
  local NET="name=eth0,bridge=${var_brg},ip=dhcp"; [ -n "$var_vlan" ] && NET="${NET},tag=${var_vlan}"
  ask_tls

  cat <<EOF

$APP will create ONE new container:
  id ${var_ctid}, hostname ${var_hostname}, UNPRIVILEGED, Debian ${var_version}, nesting+keyctl (Docker)
  ${var_cpu} cores, ${var_ram} MB, ${var_disk} GB on ${var_storage}, network ${NET}
  GPU: $([ "$var_gpu" = yes ] && echo "/dev/dri/renderD128 shared in" || echo "none (CPU transcode)")
  Install mode: ${var_install_mode}$([ "$var_install_mode" = auto ] && echo " (this version's published images if they exist, else built in the container)")   Source: ${REPO_ROOT}
  HTTPS: ${var_tls}$([ -n "$var_dns" ] && echo " through ${var_dns}") for ${var_domain}$([ "$var_tls" = own ] && echo " (your proxy: ${var_proxy_ip:-to be set in .env})")$([ "$var_tunnel" = yes ] && echo ", plus a Cloudflare tunnel")
  Then it installs Docker and prepares Mantel Server$([ "$var_tls" = own ] && echo " for your proxy" || echo " behind Caddy"). Nothing else on this host changes.
EOF
  read -r -p "Proceed? [y/N] " ok; [ "${ok,,}" = "y" ] || msg_error "cancelled"

  msg_info "Finding the Debian 13 amd64 template"
  pveam update >/dev/null
  local TEMPLATE
  TEMPLATE="$(pveam available --section system | awk '$2 ~ /^debian-13-standard_[^\/]+_amd64\.tar\./ {print $2}' | sort -V | tail -1)"
  [ -n "$TEMPLATE" ] || msg_error "no debian-13-standard amd64 template offered by pveam"
  pveam list "$var_template_storage" | grep -q "$TEMPLATE" || pveam download "$var_template_storage" "$TEMPLATE"

  msg_info "Creating container ${var_ctid}"
  pct create "$var_ctid" "${var_template_storage}:vztmpl/${TEMPLATE}" \
    --arch amd64 --hostname "$var_hostname" --unprivileged "$var_unprivileged" \
    --features nesting=1,keyctl=1 \
    --cores "$var_cpu" --memory "$var_ram" --swap 512 --rootfs "${var_storage}:${var_disk}" \
    --net0 "$NET" --onboot 0 --tags "$var_tags" \
    --description "Mantel Server (Docker Compose inside an unprivileged LXC). Manage: pct enter ${var_ctid}; update: mantel-update"
  pct start "$var_ctid"
  msg_info "Waiting for the container's network"
  for i in $(seq 1 60); do
    pct exec "$var_ctid" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
    [ "$i" -eq 60 ] && msg_error "no network in the container after 60 s (check bridge/VLAN/DHCP)"
    sleep 1
  done

  if [ "$var_gpu" = "yes" ]; then
    local RGID
    RGID="$(pct exec "$var_ctid" -- sh -c 'getent group render | cut -d: -f3')"
    if [ -z "$RGID" ]; then
      pct exec "$var_ctid" -- groupadd -r render
      RGID="$(pct exec "$var_ctid" -- sh -c 'getent group render | cut -d: -f3')"
    fi
    msg_info "Sharing /dev/dri/renderD128 (container render group gid ${RGID})"
    pct stop "$var_ctid"
    if ! pct set "$var_ctid" -dev0 "/dev/dri/renderD128,gid=${RGID}" 2>/dev/null; then
      echo "  (devN passthrough not available; using a bind mount)"
      printf '%s\n' "lxc.cgroup2.devices.allow: c 226:128 rwm" \
        "lxc.mount.entry: /dev/dri/renderD128 dev/dri/renderD128 none bind,optional,create=file" >> "/etc/pve/lxc/${var_ctid}.conf"
    fi
    pct start "$var_ctid"
    for i in $(seq 1 30); do pct exec "$var_ctid" -- true 2>/dev/null && break; sleep 1; done
    pct exec "$var_ctid" -- test -c /dev/dri/renderD128 || msg_error "renderD128 did not appear inside the container"
  fi

  push_source "$var_ctid"

  msg_info "Installing inside the container (Docker, Compose, secret folder, first start; a few minutes)"
  pct exec "$var_ctid" -- env MANTEL_INSTALL_MODE="$var_install_mode" MANTEL_GPU="$var_gpu" MANTEL_CONNECT="$var_connect" \
    MANTEL_TLS="$var_tls" MANTEL_DNS="${var_dns:-cloudflare}" MANTEL_DOMAIN="$var_domain" MANTEL_PROXY_IP="$var_proxy_ip" MANTEL_TUNNEL="$var_tunnel" \
    bash "${INSTALL_DIR}/packaging/lxc/mantel-install.sh"
}

description() {
  local ip; ip="$(pct exec "$var_ctid" -- hostname -I 2>/dev/null | awk '{print $1}')"
  msg_ok "container ${var_ctid} is running (${ip:-address pending})"
  cat <<EOF

Next steps (details: docs/phase3/PACKAGING.md):
  1. pct enter ${var_ctid}
  2. edit ${INSTALL_DIR}/packaging/compose/.env (hostname, HTTPS) if the guess was wrong
     $([ "$var_tls" = dns01 ] && echo "mantel-secret <the DNS host's secret file(s), as the install listed them>   # ${var_dns}")$([ "$var_tunnel" = yes ] && echo "
     mantel-secret cloudflared_token")
     then:  cd ${INSTALL_DIR}/packaging/compose && docker compose up -d --wait
  3. docker compose logs mantel-server     # a one-time setup code for the first Owner, in a banner
     (or from this host: pct exec ${var_ctid} -- docker logs mantel-server)
  4. $([ "$var_tls" = own ] && echo "point your proxy at http://${ip:-the container}:8765 (docs/OPERATIONS.md: the NPM block), open https://${var_domain}/login" || echo "point ${var_domain} at ${ip:-the container} in your LAN DNS, open https://${var_domain}/login") ("First start"), then
     /admin -> Connections -> "Connect to Home Assistant" (no token file to handle)$([ "$var_tls" = own ] && echo "; and /proxy-check")
Remove it any time:  pct stop ${var_ctid} && pct destroy ${var_ctid} --purge
EOF
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then return 0; fi   # sourced (the tests): the functions only
variables
start
if [ "${1:-}" = "push" ]; then  # host side of an update: send this checkout, then update inside (build mode
                                # rebuilds it; version-pinned images move to its version)
  [ -n "${2:-}" ] || msg_error "usage: bash packaging/lxc/mantel.sh push <ctid>"
  pct status "$2" >/dev/null 2>&1 || msg_error "no container $2"
  push_source "$2"
  pct exec "$2" -- mantel-update
  exit 0
fi
build_container
description
