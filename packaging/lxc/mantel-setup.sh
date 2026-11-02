#!/usr/bin/env bash
# mantel-setup: how browsers reach Mantel -- its address and HTTPS -- in the Proxmox LXC (or on a Docker host laid out
# the same way). As root:
#
#   mantel-setup              ask, change packaging/compose/.env and the secret files, start Mantel again
#   mantel-setup --install    the same without the start (the LXC install starts Mantel itself afterwards)
#   mantel-setup --address    only follow a changed container address, starting Mantel again if it changed (at boot,
#                             mantel-address.service); with --install too it changes .env alone (`update` starts it)
#
# Every run first follows the container's address: one changed since the install (a new DHCP lease, a static address
# set later) is put everywhere .env had the old one, which Mantel's published ports and allowed hosts depend on.
#
# Four ways (docs/guide/Install-Proxmox-LXC.md):
#   try       https://<this container's address>, with Mantel's own certificate: works with nothing else, the
#             browser warns until Mantel's certificate authority is trusted, and passkeys are off (a browser
#             won't use one at an address). What every install starts with.
#   internal  a name on your network (mantel.home.arpa), Mantel's own certificate; your DNS points it here
#   dns01     your own domain with a real certificate, proved through your DNS host's API (its token asked now)
#   own       your own reverse proxy (Nginx Proxy Manager, ...) owns HTTPS; Mantel publishes http://<address>:8765
# Answers can be given ahead: MANTEL_TLS, MANTEL_DOMAIN, MANTEL_DNS, MANTEL_PROXY_IP. A token is never taken from the
# environment: it is typed (hidden), or the saved one is kept. With no token (or no proxy address) the setup stays on
# "try" and says what is missing; run mantel-setup again when you have it.
set -euo pipefail

COMPOSE_DIR="${MANTEL_COMPOSE_DIR:-/opt/mantel/packaging/compose}"
SECRETS_DIR="${MANTEL_SECRETS_DIR:-/etc/hk/secrets}"
ENV_FILE="$COMPOSE_DIR/.env"
RESTART=yes
ADDRESS_ONLY=no
for arg in "$@"; do
  case "$arg" in --install) RESTART=no ;; --address) ADDRESS_ONLY=yes ;; *) ;; esac
done

say()  { printf '%s\n' "$*"; }
die()  { printf 'mantel-setup: %s\n' "$*" >&2; exit 1; }
interactive() { [ -t 0 ]; }

[ -f "$ENV_FILE" ] || die "no $ENV_FILE: is Mantel installed here?"
[ "$(id -u)" -eq 0 ] || die "run it as root (it writes the secret files)"

env_get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
set_env() {  # set_env KEY VALUE: replace KEY's line, or add it
  if grep -q "^$1=" "$ENV_FILE"; then sed -i.bak "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
  rm -f "$ENV_FILE.bak"
}
unset_env() { sed -i.bak "/^$1=/d" "$ENV_FILE"; rm -f "$ENV_FILE.bak"; }

dns_secrets() {  # the secret files each DNS host's Caddy snippet reads (as mantel-install.sh writes them)
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

this_address() {  # the container's address now: the one its default route leaves from, else its first one
  if [ -n "${MANTEL_HOST_IP:-}" ]; then echo "$MANTEL_HOST_IP"; return; fi
  local a
  a="$(ip -4 -o route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
  [ -n "$a" ] || a="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "$a"
}

follow_address() {  # follow_address OLD NEW: NEW wherever .env's address settings had OLD (MANTEL_TRUSTED_PROXY is the proxy's)
  local old_re key value moved
  old_re="$(printf '%s' "$1" | sed 's/\./\\./g')"
  for key in MANTEL_HOSTNAME MANTEL_ALLOW_HOSTS MANTEL_HTTP_BIND MANTEL_CONNECT_ADDRESS; do
    value="$(env_get "$key")"
    [ -n "$value" ] || continue
    moved="$(printf '%s' "$value" | sed -E "s/(^|[^0-9.])${old_re}([^0-9.]|$)/\1$2\2/g")"
    if [ "$moved" != "$value" ]; then set_env "$key" "$moved"; fi
  done
}

LAN_IP="$(env_get MANTEL_LAN_IP)"
HERE="$(this_address)"
MOVED=no
if [ -n "$HERE" ] && [ "$HERE" != "$LAN_IP" ]; then
  if [ -n "$LAN_IP" ]; then
    say "This container's address changed: ${LAN_IP} -> ${HERE}. Mantel follows it."
    follow_address "$LAN_IP" "$HERE"
    MOVED=yes
  fi
  set_env MANTEL_LAN_IP "$HERE"
  LAN_IP="$HERE"
fi
[ -n "$LAN_IP" ] || die "MANTEL_LAN_IP is not set in $ENV_FILE"

if [ "$ADDRESS_ONLY" = yes ]; then
  if [ "$MOVED" = yes ] && [ "$RESTART" = yes ]; then
    say "Starting Mantel again at its new address..."
    cd "$COMPOSE_DIR"
    docker compose up -d --wait --wait-timeout 300 --remove-orphans
  fi
  exit 0
fi

current_mode() {
  local files snippet
  files="$(env_get COMPOSE_FILE)"; snippet="$(env_get MANTEL_TLS_SNIPPET)"
  case "$files" in *byo-proxy*) echo own; return ;; *compose.dns-*) echo dns01; return ;; esac
  case "$snippet" in *tls-dns01*) echo dns01; return ;; esac
  if [ "$(env_get MANTEL_HOSTNAME)" = "$LAN_IP" ]; then echo try; else echo internal; fi
}

# ---- the questions ------------------------------------------------------------------------------------------------
TLS="${MANTEL_TLS:-}"
NOW="$(current_mode)"
if [ -z "$TLS" ]; then
  if interactive; then
    say ""
    say "How should browsers reach Mantel?"
    say "  1) try       Try it now: https://${LAN_IP}, with Mantel's own certificate (the browser warns once)"
    say "  2) internal  A name on your network (e.g. mantel.home.arpa), with Mantel's own certificate"
    say "  3) dns01     Your own domain, with a real certificate (your DNS host's API token)"
    say "  4) own       Your own reverse proxy owns HTTPS (Nginx Proxy Manager, Traefik, ...)"
    while [ -z "$TLS" ]; do
      read -r -p "Choose 1-4, or Enter for ${NOW}: " pick || pick=""
      case "${pick:-}" in 1|try) TLS=try ;; 2|internal) TLS=internal ;; 3|dns01) TLS=dns01 ;; 4|own) TLS=own ;;
        "") TLS="$NOW" ;; *) say "  Type 1, 2, 3 or 4." ;; esac
    done
  else
    TLS="$NOW"
  fi
fi
case "$TLS" in try|internal|dns01|own) ;; *) die "MANTEL_TLS must be try, internal, dns01 or own" ;; esac

DNS="${MANTEL_DNS:-}"
if [ "$TLS" = dns01 ] && [ -z "$DNS" ]; then
  if interactive; then
    read -r -p "Your DNS host: cloudflare, duckdns, porkbun, route53, digitalocean or desec [cloudflare]: " DNS || true
  fi
fi
DNS="${DNS:-cloudflare}"
dns_secrets "$DNS" >/dev/null || die "unknown DNS host: $DNS"

DOMAIN="${MANTEL_DOMAIN:-}"
if [ "$TLS" = internal ] || [ "$TLS" = dns01 ] || [ "$TLS" = own ]; then
  # the name it has now (none on "try"), else for a name on the network the usual one
  hint="$(env_get MANTEL_HOSTNAME)"
  if [ "$hint" = "$LAN_IP" ]; then hint=""; fi
  if [ -z "$hint" ] && [ "$TLS" = internal ]; then hint=mantel.home.arpa; fi
  if [ -z "$DOMAIN" ] && interactive; then
    read -r -p "The name browsers will use (e.g. mantel.example.com)${hint:+ [$hint]}: " DOMAIN || true
  fi
  DOMAIN="${DOMAIN:-$hint}"
  [ -n "$DOMAIN" ] || die "a name is needed for $TLS (MANTEL_DOMAIN)"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ ]] || die "not a host name: $DOMAIN"
  if [ "$TLS" = dns01 ] && [ "$DNS" = duckdns ] && [[ ! "${DOMAIN,,}" =~ \.duckdns\.org$ ]]; then
    die "with Duck DNS the name must be your <name>.duckdns.org"
  fi
fi

MISSING=""
if [ "$TLS" = dns01 ]; then
  for f in $(dns_secrets "$DNS"); do
    if [ -s "$SECRETS_DIR/$f" ]; then
      interactive && { read -rs -p "Value for $f (Enter keeps the saved one): " v || true; echo; } || v=""
    else
      v=""
      interactive && { read -rs -p "Value for $f (Enter to skip for now): " v || true; echo; }
    fi
    if [ -n "${v:-}" ]; then
      ( umask 077; printf '%s' "$v" > "$SECRETS_DIR/$f" )
      chown root:10001 "$SECRETS_DIR/$f" 2>/dev/null || true; chmod 0440 "$SECRETS_DIR/$f"
    fi
    [ -s "$SECRETS_DIR/$f" ] || MISSING="$MISSING $f"
  done
  unset v
fi

PROXY_IP="${MANTEL_PROXY_IP:-}"
if [ "$TLS" = own ]; then
  [ -n "$PROXY_IP" ] || PROXY_IP="$(env_get MANTEL_TRUSTED_PROXY)"
  if [ -z "$PROXY_IP" ] && interactive; then
    read -r -p "Your proxy's IP address, as Mantel will see it (Enter to skip for now): " PROXY_IP || true
  fi
  [ -z "$PROXY_IP" ] || [[ "$PROXY_IP" =~ ^[0-9A-Fa-f:.]+$ ]] || die "not an IP address: $PROXY_IP"
  [ -n "$PROXY_IP" ] || MISSING=" your proxy's address"
fi

WANTED="$TLS"
if [ -n "$MISSING" ]; then
  say ""
  say "Not yet: $WANTED needs${MISSING}. Mantel stays at https://${LAN_IP} for now; run mantel-setup again when you have it."
  TLS=try
fi

# ---- .env ---------------------------------------------------------------------------------------------------------
# COMPOSE_FILE keeps what isn't about HTTPS (the GPU, Mantel Connect, ...) and gets this way's file, if it has one
files=""
IFS=: read -r -a parts <<< "$(env_get COMPOSE_FILE)"
for f in "${parts[@]}"; do
  case "$f" in ""|compose.yaml|compose.byo-proxy.yaml|compose.dns-*.yaml) ;; *) files="$files:$f" ;; esac
done
case "$TLS" in
  dns01) [ "$DNS" = cloudflare ] || files=":compose.dns-${DNS}.yaml$files" ;;
  own) files=":compose.byo-proxy.yaml$files" ;;
esac
set_env COMPOSE_FILE "compose.yaml$files"

case "$TLS" in
  try)      set_env MANTEL_HOSTNAME "$LAN_IP"; set_env MANTEL_TLS_SNIPPET ./caddy/tls-internal.caddy ;;
  internal) set_env MANTEL_HOSTNAME "$DOMAIN"; set_env MANTEL_TLS_SNIPPET ./caddy/tls-internal.caddy ;;
  dns01)    set_env MANTEL_HOSTNAME "$DOMAIN"
            if [ "$DNS" = cloudflare ]; then set_env MANTEL_TLS_SNIPPET ./caddy/tls-dns01-cloudflare.caddy
            else unset_env MANTEL_TLS_SNIPPET; fi ;;   # compose.dns-<host>.yaml mounts its own snippet
  own)      set_env MANTEL_HOSTNAME "$DOMAIN"; set_env MANTEL_TLS_SNIPPET ./caddy/tls-internal.caddy ;;
esac
set_env MANTEL_ALLOW_HOSTS "$LAN_IP"
if [ "$TLS" = own ]; then
  set_env MANTEL_TRUSTED_PROXY "$PROXY_IP"; set_env MANTEL_HTTP_BIND "$LAN_IP"
else
  unset_env MANTEL_TRUSTED_PROXY; unset_env MANTEL_HTTP_BIND
fi

# ---- start it again -------------------------------------------------------------------------------------------------
if [ "$RESTART" = yes ]; then
  say ""
  say "Starting Mantel again with these settings..."
  cd "$COMPOSE_DIR"
  [ "$TLS" = own ] && docker compose stop caddy >/dev/null 2>&1 || true
  docker compose up -d --wait --wait-timeout 300 --remove-orphans
fi

HOST="$(env_get MANTEL_HOSTNAME)"
say ""
case "$TLS" in
  try)      say "Mantel: https://${HOST}/login  (your browser warns about Mantel's own certificate until you trust it; passkeys are off at an address)" ;;
  internal) say "Mantel: https://${HOST}/login  once ${HOST} points at ${LAN_IP} in your home's DNS (trust Mantel's own certificate authority on each device)" ;;
  dns01)    say "Mantel: https://${HOST}/login  once ${HOST} points at ${LAN_IP} in your home's DNS; the certificate comes from ${DNS}" ;;
  own)      say "Mantel: https://${HOST}/login  once your proxy sends ${HOST} to http://${LAN_IP}:8765 (WebSockets on, the door key"
            say "        from: docker compose exec mantel-server mantel door-key); then open /proxy-check as the Owner" ;;
esac
say "Change it any time: mantel-setup"
