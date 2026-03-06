#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
APP_NAME="${APP_NAME:-cubic}"
APP_PORT="${APP_PORT:-3002}"
DOMAIN="${DOMAIN:-_}"

step() {
  printf "\n==> %s\n" "$1"
}

ensure_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "Missing required command: $1" >&2
  exit 1
}

step "Checking system dependencies"
ensure_cmd git
ensure_cmd npm
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

if [ "$(id -u)" -eq 0 ] && [ ! -f "/etc/nginx/sites-available/$APP_NAME" ]; then
  step "Initial nginx setup"
  APP_DIR="$APP_DIR" APP_NAME="$APP_NAME" APP_PORT="$APP_PORT" bash "$APP_DIR/setup-vps.sh" "$DOMAIN"
fi

step "Updating repository"
git -C "$APP_DIR" fetch "$REMOTE"
git -C "$APP_DIR" checkout "$BRANCH"
git -C "$APP_DIR" pull --ff-only "$REMOTE" "$BRANCH"

step "Installing dependencies"
cd "$APP_DIR"
npm ci

step "Building client"
npm run build

step "Restarting websocket server"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  APP_NAME="$APP_NAME" PORT="$APP_PORT" pm2 restart ecosystem.config.cjs --only "$APP_NAME" --update-env
else
  APP_NAME="$APP_NAME" PORT="$APP_PORT" pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env
fi
pm2 save

if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled nginx >/dev/null 2>&1; then
  step "Reloading nginx"
  systemctl reload nginx || systemctl restart nginx
fi

step "Deploy complete"
echo "App: $APP_NAME"
echo "Dir: $APP_DIR"
echo "Branch: $BRANCH"
echo "WS port: $APP_PORT"
