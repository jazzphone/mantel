#!/usr/bin/env bash
# Run INSIDE the existing proof LXC (pct enter 103), never on Proxmox itself.
# Installs dependencies only in that test container and leaves the proof in the foreground.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/mantel-connect-proof
[ "$(id -u)" -eq 0 ] || { echo 'Run as root inside the proof LXC.' >&2; exit 1; }
[ "$(hostname)" = mantel-proof4 ] || { echo 'Expected the existing mantel-proof4 LXC. Do not run on the Proxmox host.' >&2; exit 1; }
[ ! -e "$DEST" ] || { echo "$DEST already exists; use its printed run command to resume, or inspect it before replacing anything." >&2; exit 1; }
[ -f "$HERE/mantel_server/network/connect_proof.py" ] || { echo 'Use the staged receiver bundle.' >&2; exit 1; }
echo 'Container addresses:'
hostname -I
read -r -p 'Container IPv4 address reachable from Home Assistant (no port): ' RECEIVER_IP
read -r -p 'Your linked HA Owner user id (from mantel-server links on the Mac): ' OWNER_ID
read -r -p 'Display name [Owner]: ' OWNER_NAME
OWNER_NAME="${OWNER_NAME:-Owner}"
[[ "$RECEIVER_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'An IPv4 address is required.' >&2; exit 1; }
[[ "$OWNER_ID" =~ ^[A-Za-z0-9_-]{1,128}$ ]] || { echo 'Invalid HA user id.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive LC_ALL=C
apt-get update -qq
apt-get install -y -qq python3-venv openssl ca-certificates >/dev/null
python3 -c 'import ipaddress,sys; ipaddress.IPv4Address(sys.argv[1])' "$RECEIVER_IP"
umask 077
mkdir "$DEST"
cp -R "$HERE/mantel_server" "$HERE/mantel_connect" "$DEST/"
python3 -m venv "$DEST/venv"
"$DEST/venv/bin/python" -m pip install --quiet aiohttp==3.14.5
openssl rand -hex 32 > "$DEST/channel.key"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout "$DEST/receiver.key" -out "$DEST/receiver.crt" \
  -subj /CN=mantel-connect-proof \
  -addext "subjectAltName=IP:${RECEIVER_IP}" \
  -addext 'basicConstraints=critical,CA:TRUE' 2>/dev/null
cd "$DEST"
"$DEST/venv/bin/python" - "$OWNER_ID" "$OWNER_NAME" <<'PY'
from pathlib import Path
import sys
from mantel_server.storage.store import Store
store = Store(Path('/opt/mantel-connect-proof/data/mantel.db'))
store.link(sys.argv[1], 'owner', sys.argv[2])
store.db.close()
PY
cat > "$DEST/run.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$DEST"
exec "$DEST/venv/bin/python" -m mantel_server.network.connect_proof --host "$RECEIVER_IP" --port 8766 --data-dir "$DEST/data" --key-file "$DEST/channel.key" --tls-cert "$DEST/receiver.crt" --tls-key "$DEST/receiver.key"
EOF
chmod 700 "$DEST/run.sh"
echo "Receiver prepared: https://${RECEIVER_IP}:8766"
echo "Copy ONLY channel.key and receiver.crt to the HA App's configuration folder. Keep receiver.key here."
echo "To run the receiver in this terminal: bash $DEST/run.sh"
echo 'It does not start automatically. Existing GPU/Docker proof files are untouched.'
