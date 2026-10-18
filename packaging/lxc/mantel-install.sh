#!/usr/bin/env bash
# Runs INSIDE the Mantel container (mantel.sh executes it with pct exec). Debian 13, as root.
# Installs Docker + Compose, prepares the secret folder and .env, and builds the images.
# It does NOT start Mantel (printed at the end). Home Assistant is connected afterwards in the browser
# (/admin -> Connections), so no token file has to be handled.
# Idempotent: running it again keeps your .env and secret files.
set -euo pipefail

INSTALL_DIR="/opt/mantel"
COMPOSE_DIR="$INSTALL_DIR/packaging/compose"
SECRETS_DIR="/etc/hk/secrets"
MODE="${MANTEL_INSTALL_MODE:-build}"
GPU="${MANTEL_GPU:-no}"
TLS="${MANTEL_TLS:-}"            # dns01 | internal | own (mantel.sh asks; docs/OPERATIONS.md "HTTPS: four ways")
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
for f in ha_token ma_token cloudflare_dns_token cloudflared_token; do
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
case "$name" in ha_token|ma_token|cloudflare_dns_token|cloudflared_token) ;; *) echo "usage: mantel-secret ha_token|ma_token|cloudflare_dns_token|cloudflared_token" >&2; exit 2 ;; esac
read -rs -p "Value for $name: " value; echo
[ -n "$value" ] || { echo "empty: nothing written" >&2; exit 1; }
umask 077
printf '%s' "$value" > "/etc/hk/secrets/$name"
chown root:10001 "/etc/hk/secrets/$name"; chmod 0440 "/etc/hk/secrets/$name"
echo "written. Apply with: cd /opt/mantel/packaging/compose && docker compose up -d --wait   (already running? docker compose restart caddy mantel-server: a changed secret file is not noticed otherwise)"
EOS
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
    own)      add_compose_file compose.byo-proxy.yaml
              printf '%s\n' "MANTEL_TRUSTED_PROXY=${PROXY_IP}" "MANTEL_HTTP_BIND=${lan_ip}" >> "$COMPOSE_DIR/.env"
              [ -n "$PROXY_IP" ] || warn "set MANTEL_TRUSTED_PROXY in .env to your proxy's address before the first start"
              msg_ok "HTTPS: your own proxy; Mantel publishes http://${lan_ip}:8765 for it (compose.byo-proxy.yaml)" ;;
    dns01|"") msg_ok "HTTPS: Caddy with your domain (DNS-01); needs mantel-secret cloudflare_dns_token" ;;
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

if [ "$MODE" = "build" ]; then
  msg_info "Building the images from the copied source (several minutes)"
  ( cd "$COMPOSE_DIR" && docker compose build ) || warn "the build failed. If it names a sha256:0000 digest, pin the base images (docs/phase3/PACKAGING.md), then run: cd $COMPOSE_DIR && docker compose build"
else
  msg_info "Install mode 'pull': images are pulled by docker compose up (set the image references in .env)"
fi

cat <<EOF

Installed. Mantel is NOT running yet. Finish like this:
  1. nano ${COMPOSE_DIR}/.env               # check MANTEL_HOSTNAME and the HTTPS choice (no Home Assistant token needed)
$([ "$TLS" = "dns01" ] || [ -z "$TLS" ] && echo "     mantel-secret cloudflare_dns_token     # DNS-01: a token limited to Zone / DNS / Edit for one zone")$([ "$TUNNEL" = "yes" ] && echo "
     mantel-secret cloudflared_token        # then start with: docker compose --profile tunnel up -d --wait")
  2. cd ${COMPOSE_DIR} && docker compose up -d --wait$([ "$TLS" = "own" ] && echo "
     then point your proxy at http://$(hostname -I | awk '{print $1}'):8765 with WebSockets on and the X-Mantel-Door
     header (docs/OPERATIONS.md 'HTTPS: four ways'), and open https://${DOMAIN:-<your name>}/proxy-check as the Owner")
  3. docker compose exec mantel-server mantel bootstrap   # a one-time setup code for the first Owner
  4. In a browser: https://${DOMAIN:-<MANTEL_HOSTNAME>}/login -> "First start": the code, your user name and password
  5. Then /admin -> Connections -> "Connect to Home Assistant" (sign in there as a dedicated HA
     administrator, e.g. "mantel-server"), and Music Assistant if you use it. No restart needed.
$([ "${MANTEL_CONNECT:-no}" = "yes" ] && echo "  6. Mantel in Home Assistant's sidebar: install the Mantel Connect App there, then
       docker compose exec mantel-server mantel connect pair --address $(hostname -I | awk '{print $1}'):8766
     (docs/phase3/CONNECT.md)")
EOF
