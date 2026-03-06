#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="${VPS_HOST:?Set VPS_HOST (e.g. root@1.2.3.4)}"
VPS_PATH="${VPS_PATH:-/var/www/cubic}"
APP_NAME="${APP_NAME:-cubic}"
APP_PORT="${APP_PORT:-3002}"

echo "==> Syncing project to $VPS_HOST:$VPS_PATH"
ssh "$VPS_HOST" "mkdir -p '$VPS_PATH'"
rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "dist" \
  --exclude ".DS_Store" \
  --exclude "server/game.db" \
  --exclude "server/game.db-shm" \
  --exclude "server/game.db-wal" \
  ./ "$VPS_HOST:$VPS_PATH/"

echo "==> Installing dependencies and building on VPS"
ssh "$VPS_HOST" "cd '$VPS_PATH' && npm ci && npm run build"

echo "==> Starting websocket server via pm2"
ssh "$VPS_HOST" "cd '$VPS_PATH' && APP_NAME='$APP_NAME' PORT='$APP_PORT' pm2 describe '$APP_NAME' >/dev/null 2>&1 && APP_NAME='$APP_NAME' PORT='$APP_PORT' pm2 restart ecosystem.config.cjs --only '$APP_NAME' --update-env || APP_NAME='$APP_NAME' PORT='$APP_PORT' pm2 start ecosystem.config.cjs --only '$APP_NAME' --update-env"
ssh "$VPS_HOST" "pm2 save"

echo "==> Done"
echo "    Static client: $VPS_PATH/dist"
echo "    Websocket app: pm2 process '$APP_NAME' on port $APP_PORT"
