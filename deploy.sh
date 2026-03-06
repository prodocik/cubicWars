#!/usr/bin/env bash
set -euo pipefail

# --- Config ---
VPS_HOST="${VPS_HOST:?Set VPS_HOST (e.g. user@1.2.3.4)}"
VPS_PATH="${VPS_PATH:-/var/www/game}"

echo "==> Building..."
npm run build

echo "==> Deploying to $VPS_HOST:$VPS_PATH"
ssh "$VPS_HOST" "mkdir -p $VPS_PATH"
rsync -avz --delete dist/ "$VPS_HOST:$VPS_PATH/"

echo "==> Done! Deployed to $VPS_PATH"
