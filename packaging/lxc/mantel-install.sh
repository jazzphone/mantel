#!/usr/bin/env bash
# Runs INSIDE the Mantel container (mantel.sh executes it with pct exec). Debian 13, as root.
# Installs Docker + Compose, prepares the secret folder and .env, and pulls this version's published images
# (ghcr.io/jazzphone/mantel-*:<version>), or builds them from the copied source when they are not published.
# It does NOT start Mantel (printed at the end). Home Assistant is connected afterwards in the browser
# (/admin -> Connections), so no token file has to be handled.
# Idempotent: running it again keeps your .env and secret files.
set -euo pipefail

INSTALL_DIR="/opt/mantel"
COMPOSE_DIR="$INSTALL_DIR/packaging/compose"
SECRETS_DIR="/etc/hk/secrets"
MODE="${MANTEL_INSTALL_MODE:-auto}"   # auto (pull this version's images, else build) | pull | build
GPU="${MANTEL_GPU:-no}"
TLS="${MANTEL_TLS:-internal}"    # internal | dns01 | own (mantel.sh asks; docs/OPERATIONS.md "HTTPS: four ways")
DNS="${MANTEL_DNS:-cloudflare}"  # dns01's DNS host: cloudflare | duckdns | porkbun | route53 | digitalocean | desec
REGISTRY="ghcr.io/jazzphone"
# Secret files per DNS host (packaging/compose/caddy/tls-dns01-<host>.caddy reads them)
dns_secrets() {
  case "$1" in
    cloudflare) echo cloudflare_dns_token ;;
    duckdns) echo duckdns_token ;;
    porkbun) echo porkbun_api_key porkbun_secret_api_key ;;
    route53) echo route53_access_key_id route53_secret_access_key ;;
    digitalocean) echo digitalocean_token ;;
    desec) echo desec_token ;;
    *) return 1 ;;
  esac
}
DNS_SECRETS="cloudflare_dns_token duckdns_token porkbun_api_key porkbun_secret_api_key route53_access_key_id route53_secret_access_key digitalocean_token desec_token"
DOMAIN="${MANTEL_DOMAIN:-}"
PROXY_IP="${MANTEL_PROXY_IP:-}"
TUNNEL="${MANTEL_TUNNEL:-no}"

msg_info() { printf '\n==> %s\n' "$*"; }
msg_ok()   { printf '    ok: %s\n' "$*"; }
warn()     { printf '    WARNING: %s\n' "$*" >&2; }
die()      { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
grep -q '^VERSION_ID="13"' /etc/os-release || die "Debian 13 only"
[ -d "$COMPOSE_DIR" ] || die "$COMPOSE_DIR missing: the source was not copied in"
case "$MODE" in auto|pull|build) ;; *) die "MANTEL_INSTALL_MODE must be auto, pull or build" ;; esac
case "$TLS" in internal|dns01|own) ;; *) die "MANTEL_TLS must be internal, dns01 or own" ;; esac
dns_secrets "$DNS" >/dev/null || die "MANTEL_DNS must be cloudflare, duckdns, porkbun, route53, digitalocean or desec"
# this source's version: the published images are tagged with it (tools/check_version.py)
VERSION="$(sed -n 's/^version: *"\{0,1\}\([0-9][0-9A-Za-z.+-]*\)"\{0,1\} *$/\1/p' "$INSTALL_DIR/packaging/ha-app/config.yaml" | head -1)"

msg_info "Installing Docker, Compose and unattended security upgrades"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl docker.io unattended-upgrades >/dev/null
# Compose v2 as the `docker compose` plugin; Debian's package name differs between releases.
apt-get install -y -qq docker-compose-v2 >/dev/null 2>&1 || apt-get install -y -qq docker-compose >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "no 'docker compose' after installing Debian's packages; install the Compose v2 plugin and re-run"
mkdir -p /etc/docker
[ -f /etc/docker/daemon.json ] || printf '%s\n' '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' > /etc/docker/daemon.json
systemctl enable --now docker >/dev/null
docker info >/dev/null || die "Docker did not start (in an unprivileged LXC this needs nesting=1,keyctl=1 on the container)"
printf '%s\n' 'APT::Periodic::Update-Package-Lists "1";' 'APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades
msg_ok "docker $(docker --version | awk '{print $3}' | tr -d ,)"

msg_info "Secret folder ${SECRETS_DIR} (root:10001, mode 0440; never in the repo, the image or .env)"
install -d -m 0750 -o root -g 10001 "$SECRETS_DIR"
for f in ha_token ma_token cloudflared_token $DNS_SECRETS; do
  [ -e "$SECRETS_DIR/$f" ] || { : > "$SECRETS_DIR/$f"; }
done
# the at-rest and backup keys (32 random bytes, base64), named as the server reads them; an older
# data_key becomes at_rest.key. Keep a copy of both OFF this machine: a restore needs them.
[ -e "$SECRETS_DIR/data_key" ] && [ ! -e "$SECRETS_DIR/at_rest.key" ] && mv "$SECRETS_DIR/data_key" "$SECRETS_DIR/at_rest.key"
for k in at_rest.key backup.key; do
  [ -e "$SECRETS_DIR/$k" ] || { umask 077; head -c 32 /dev/urandom | base64 > "$SECRETS_DIR/$k"; }
  chown root:10001 "$SECRETS_DIR/$k"; chmod 0440 "$SECRETS_DIR/$k"
done
chown root:10001 "$SECRETS_DIR"/* && chmod 0440 "$SECRETS_DIR"/*

cat > /usr/local/sbin/mantel-secret <<'EOS'
#!/usr/bin/env bash
# mantel-secret NAME : read a secret from the keyboard (no echo, no history) into /etc/hk/secrets/NAME
set -euo pipefail
name="${1:-}"
names=" ha_token ma_token cloudflared_token __DNS_SECRETS__ "
case "$names" in *" $name "*) [ -n "$name" ] ;; *) false ;; esac || { echo "usage: mantel-secret NAME, one of:$names" >&2; exit 2; }
read -rs -p "Value for $name: " value; echo
[ -n "$value" ] || { echo "empty: nothing written" >&2; exit 1; }
umask 077
printf '%s' "$value" > "/etc/hk/secrets/$name"
chown root:10001 "/etc/hk/secrets/$name"; chmod 0440 "/etc/hk/secrets/$name"
echo "written. Apply with: cd /opt/mantel/packaging/compose && docker compose up -d --wait   (already running? docker compose restart caddy mantel-server: a changed secret file is not noticed otherwise)"
EOS
sed -i "s|__DNS_SECRETS__|${DNS_SECRETS}|" /usr/local/sbin/mantel-secret
cat > /usr/local/bin/mantel-update <<'EOS'
#!/usr/bin/env bash
exec bash /opt/mantel/packaging/lxc/mantel.sh update
EOS
chmod 0750 /usr/local/sbin/mantel-secret; chmod 0755 /usr/local/bin/mantel-update

msg_info "Settings file ${COMPOSE_DIR}/.env (settings only; keeps yours if it exists)"
if [ ! -f "$COMPOSE_DIR/.env" ]; then
  lan_ip="$(hostname -I | awk '{print $1}')"
  cp "$COMPOSE_DIR/.env.example" "$COMPOSE_DIR/.env"
  sed -i "s|^MANTEL_LAN_IP=.*|MANTEL_LAN_IP=${lan_ip}|" "$COMPOSE_DIR/.env"
  sed -i "s|^MANTEL_ALLOW_HOSTS=.*|MANTEL_ALLOW_HOSTS=${lan_ip}|" "$COMPOSE_DIR/.env"
  # the nightly backup on (Backups.md): compose mounts MANTEL_BACKUP_DIR (./backups, made below) at /backups
  sed -i "s|^MANTEL_BACKUP_TARGET=.*|MANTEL_BACKUP_TARGET=/backups|" "$COMPOSE_DIR/.env"
  add_compose_file() {   # add_compose_file NAME: append to COMPOSE_FILE (creating it with compose.yaml first)
    if grep -q '^COMPOSE_FILE=' "$COMPOSE_DIR/.env"; then
      sed -i "s|^COMPOSE_FILE=\(.*\)$|COMPOSE_FILE=\1:$1|" "$COMPOSE_DIR/.env"
    else
      printf '%s\n' "COMPOSE_FILE=compose.yaml:$1" >> "$COMPOSE_DIR/.env"
    fi
  }
  [ -n "$DOMAIN" ] && sed -i "s|^MANTEL_HOSTNAME=.*|MANTEL_HOSTNAME=${DOMAIN}|" "$COMPOSE_DIR/.env"
  case "$TLS" in
    internal) sed -i "s|^MANTEL_TLS_SNIPPET=.*|MANTEL_TLS_SNIPPET=./caddy/tls-internal.caddy|" "$COMPOSE_DIR/.env"
              msg_ok "HTTPS: Caddy's own certificate authority (trust its root on each device)" ;;
    dns01)    if [ "$DNS" = cloudflare ]; then
                sed -i "s|^MANTEL_TLS_SNIPPET=.*|MANTEL_TLS_SNIPPET=./caddy/tls-dns01-cloudflare.caddy|" "$COMPOSE_DIR/.env"
              else
                add_compose_file "compose.dns-${DNS}.yaml"     # its snippet and secret files
                sed -i "s|^MANTEL_TLS_SNIPPET=.*|#MANTEL_TLS_SNIPPET= (not used: compose.dns-${DNS}.yaml mounts tls-dns01-${DNS}.caddy)|" "$COMPOSE_DIR/.env"
              fi
              msg_ok "HTTPS: Caddy with your domain through ${DNS} (DNS-01); needs: $(for f in $(dns_secrets "$DNS"); do printf 'mantel-secret %s; ' "$f"; done)" ;;
    own)      add_compose_file compose.byo-proxy.yaml
              printf '%s\n' "MANTEL_TRUSTED_PROXY=${PROXY_IP}" "MANTEL_HTTP_BIND=${lan_ip}" >> "$COMPOSE_DIR/.env"
              [ -n "$PROXY_IP" ] || warn "set MANTEL_TRUSTED_PROXY in .env to your proxy's address before the first start"
              msg_ok "HTTPS: your own proxy; Mantel publishes http://${lan_ip}:8765 for it (compose.byo-proxy.yaml)" ;;
  esac
  if [ "$GPU" = "yes" ] && [ -c /dev/dri/renderD128 ]; then
    rgid="$(getent group render | cut -d: -f3)"
    add_compose_file compose.gpu.yaml
    printf '%s\n' "MANTEL_RENDER_GID=${rgid}" >> "$COMPOSE_DIR/.env"
    msg_ok "GPU: render group ${rgid}, compose.gpu.yaml enabled"
  fi
  if [ "${MANTEL_CONNECT:-no}" = "yes" ]; then
    add_compose_file compose.connect.yaml
    printf '%s\n' "MANTEL_CONNECT_ADDRESS=${lan_ip}:8766" >> "$COMPOSE_DIR/.env"
    msg_ok "Mantel Connect: compose.connect.yaml enabled (port 8766); pair it after the first start"
  fi
  chmod 0640 "$COMPOSE_DIR/.env"
  # the nightly backup's folder (MANTEL_BACKUP_DIR defaults to ./backups): Docker would create it root-owned,
  # and the server runs as uid 10001
  install -d -m 0750 -o 10001 -g 10001 "$COMPOSE_DIR/backups"
  msg_ok "wrote .env with this container's address ${lan_ip}; check MANTEL_HOSTNAME (Home Assistant is connected in the browser later)"
fi

set_env() {  # set_env KEY VALUE: replace KEY's line in .env, or add it
  if grep -q "^$1=" "$COMPOSE_DIR/.env"; then sed -i "s|^$1=.*|$1=$2|" "$COMPOSE_DIR/.env"; else printf '%s=%s\n' "$1" "$2" >> "$COMPOSE_DIR/.env"; fi
}
pull_published() {  # this version's three published images; all of them or none
  [ -n "$VERSION" ] || { warn "no version found in packaging/ha-app/config.yaml"; return 1; }
  local image
  for image in mantel-server mantel-transcode mantel-caddy; do
    docker pull -q "$REGISTRY/$image:$VERSION" >/dev/null 2>&1 || return 1
  done
  set_env MANTEL_SERVER_IMAGE "$REGISTRY/mantel-server:$VERSION"
  set_env MANTEL_TRANSCODE_IMAGE "$REGISTRY/mantel-transcode:$VERSION"
  set_env MANTEL_CADDY_IMAGE "$REGISTRY/mantel-caddy:$VERSION"
}
if [ "$MODE" != "build" ]; then
  msg_info "Pulling the published images for ${VERSION:-this version} from ${REGISTRY}"
  if pull_published; then
    msg_ok "images ${REGISTRY}/mantel-{server,transcode,caddy}:${VERSION} (set in .env; mantel-update follows the source's version)"
  elif [ "$MODE" = "pull" ]; then
    die "the published images for ${VERSION:-this version} could not be pulled from ${REGISTRY} (install mode pull); use var_install_mode=build to build them here"
  else
    msg_ok "not published (yet) for ${VERSION:-this version}: building them from the copied source instead"
    MODE=build
  fi
fi
if [ "$MODE" = "build" ]; then
  msg_info "Building the images from the copied source (several minutes)"
  ( cd "$COMPOSE_DIR" && docker compose build ) || warn "the build failed. If it names a sha256:0000 digest, pin the base images (docs/phase3/PACKAGING.md), then run: cd $COMPOSE_DIR && docker compose build"
fi

cat <<EOF

Installed. Mantel is NOT running yet. Finish like this:
  1. nano ${COMPOSE_DIR}/.env               # check MANTEL_HOSTNAME and the HTTPS choice (no Home Assistant token needed)
$([ "$TLS" = "dns01" ] && for f in $(dns_secrets "$DNS"); do printf '     mantel-secret %-26s # DNS-01 through %s (docs/OPERATIONS.md "HTTPS: four ways")\n' "$f" "$DNS"; done)$([ "$TUNNEL" = "yes" ] && echo "
     mantel-secret cloudflared_token        # then start with: docker compose --profile tunnel up -d --wait")
  2. cd ${COMPOSE_DIR} && docker compose up -d --wait$([ "$TLS" = "own" ] && echo "
     then point your proxy at http://$(hostname -I | awk '{print $1}'):8765 with WebSockets on and the X-Mantel-Door
     header (docs/OPERATIONS.md 'HTTPS: four ways'), and open https://${DOMAIN:-<your name>}/proxy-check as the Owner")
  3. docker compose logs mantel-server      # its banner shows a one-time setup code for the first Owner
     (from the Proxmox host: pct exec <id> -- docker logs mantel-server; a new one now: docker compose exec mantel-server mantel bootstrap)
  4. In a browser: https://${DOMAIN:-<MANTEL_HOSTNAME>}/login -> "First start": the code, your user name and password$([ "$TLS" = "internal" ] && echo "
     (Caddy's own CA: trust its root on each device first, docs/OPERATIONS.md 'HTTPS: four ways')")
  5. Then /admin -> Connections -> "Connect to Home Assistant" (sign in there as a dedicated HA
     administrator, e.g. "mantel-server"), and Music Assistant if you use it. No restart needed.
$([ "${MANTEL_CONNECT:-no}" = "yes" ] && echo "  6. Mantel in Home Assistant's sidebar: install the Mantel Connect App there, then
       docker compose exec mantel-server mantel connect pair --address $(hostname -I | awk '{print $1}'):8766
     (docs/phase3/CONNECT.md)")
EOF
