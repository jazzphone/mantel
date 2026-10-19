#!/bin/sh
# Deploy the Mantel push relay (packaging/push-relay/) with wrangler. Secrets are read from files and piped, never
# printed: ~/.config/mantel/secrets/cloudflare_token (the API token) and apns_key.p8 (the APNs key).
# Usage: tools/deploy_push_relay.sh <cloudflare account id>
set -eu
ACCOUNT="$1"
SECRETS="$HOME/.config/mantel/secrets"
DIR="$(cd "$(dirname "$0")/../packaging/push-relay" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$DIR/worker.js" "$DIR/schema.sql" "$DIR/wrangler.toml" "$WORK/"
cd "$WORK"
export CLOUDFLARE_API_TOKEN="$(cat "$SECRETS/cloudflare_token")"
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT"
W="npx --yes wrangler@4"
# the D1 database: made once, found again later
ID="$($W d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s||"[]").find(d=>d.name==="mantel-push");process.stdout.write(x?x.uuid:"")})')"
if [ -z "$ID" ]; then
  $W d1 create mantel-push >/dev/null
  ID="$($W d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(JSON.parse(s).find(d=>d.name==="mantel-push").uuid)})')"
fi
sed -i '' "s/REPLACE_AT_DEPLOY/$ID/" wrangler.toml
$W d1 execute mantel-push --remote --file schema.sql >/dev/null
$W deploy
$W secret put APNS_KEY < "$SECRETS/apns_key.p8" >/dev/null
echo "deployed; database $ID"
