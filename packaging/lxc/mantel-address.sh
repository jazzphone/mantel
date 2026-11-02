#!/usr/bin/env bash
# mantel-address.sh install: the boot service that keeps Mantel at the container's address. As root, in the LXC.
#
# mantel-address.service runs `mantel-setup --address` once at each boot, after Docker and the network: when the
# container's address changed (a new DHCP lease, a static address set after the install), .env follows it and Mantel
# starts again there. Otherwise it does nothing. mantel-install.sh installs it; `update` adds it to older containers.
set -euo pipefail

UNIT_DIR="${MANTEL_SYSTEMD_DIR:-/etc/systemd/system}"
UNIT="$UNIT_DIR/mantel-address.service"

[ "${1:-}" = install ] || { echo "usage: mantel-address.sh install" >&2; exit 2; }

cat > "$UNIT" <<'EOF'
[Unit]
Description=Mantel follows this container's address (mantel-setup --address)
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/mantel/packaging/lxc/mantel-setup.sh --address
TimeoutStartSec=360

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "$UNIT"
if command -v systemctl >/dev/null 2>&1 && [ -z "${MANTEL_SYSTEMD_DIR:-}" ]; then
  systemctl daemon-reload
  systemctl enable mantel-address.service >/dev/null 2>&1
fi
