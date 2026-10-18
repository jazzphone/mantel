#!/usr/bin/env bash
# Runs INSIDE the Mantel container (mantel.sh executes it with pct exec). Debian 13, as root.
# Installs Docker + Compose, prepares the secret folder and .env, and builds the images.
# It does NOT start Mantel: that needs your Home Assistant token first (printed at the end).
# Idempotent: running it again keeps your .env and secret files.
set -euo pipefail

INSTALL_DIR="/opt/mantel"
COMPOSE_DIR="$INSTALL_DIR/packaging/compose"
SECRETS_DIR="/etc/hk/secrets"
MODE="${MANTEL_INSTALL_MODE:-build}"
GPU="${MANTEL_GPU:-no}"

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
echo "written. Apply with: cd /opt/mantel/packaging/compose && docker compose up -d --wait"
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
  if [ "$GPU" = "yes" ] && [ -c /dev/dri/renderD128 ]; then
    rgid="$(getent group render | cut -d: -f3)"
    printf '%s\n' "COMPOSE_FILE=compose.yaml:compose.gpu.yaml" "MANTEL_RENDER_GID=${rgid}" >> "$COMPOSE_DIR/.env"
    msg_ok "GPU: render group ${rgid}, compose.gpu.yaml enabled"
  fi
  chmod 0640 "$COMPOSE_DIR/.env"
  msg_ok "wrote .env with this container's address ${lan_ip}; edit MANTEL_HOSTNAME and MANTEL_HA_URL"
fi

if [ "$MODE" = "build" ]; then
  msg_info "Building the images from the copied source (several minutes)"
  ( cd "$COMPOSE_DIR" && docker compose build ) || warn "the build failed. If it names a sha256:0000 digest, pin the base images (docs/phase3/PACKAGING.md), then run: cd $COMPOSE_DIR && docker compose build"
else
  msg_info "Install mode 'pull': images are pulled by docker compose up (set the image references in .env)"
fi

cat <<EOF

Installed. Mantel is NOT running yet. Finish like this:
  1. mantel-secret ha_token                 # token of the dedicated HA user "mantel-server"
  2. nano ${COMPOSE_DIR}/.env               # MANTEL_HOSTNAME, MANTEL_HA_URL, TLS choice
     (DNS-01 TLS also needs:  mantel-secret cloudflare_dns_token)
  3. cd ${COMPOSE_DIR} && docker compose up -d --wait
  4. docker compose run --rm mantel-server links     # first-Owner linking stays an explicit admin step
EOF
