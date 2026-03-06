#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="${VPS_HOST:?Set VPS_HOST (e.g. root@1.2.3.4)}"
VPS_PATH="${VPS_PATH:-/var/www/cubic}"
REPO_URL="${REPO_URL:-https://github.com/prodocik/cubicWars.git}"
BRANCH="${BRANCH:-main}"
APP_NAME="${APP_NAME:-cubic}"
APP_PORT="${APP_PORT:-3002}"
DOMAIN="${DOMAIN:-_}"

echo "==> Preparing repository on $VPS_HOST:$VPS_PATH"
ssh "$VPS_HOST" "if [ -d '$VPS_PATH/.git' ]; then git -C '$VPS_PATH' remote set-url origin '$REPO_URL'; else git clone '$REPO_URL' '$VPS_PATH'; fi"

echo "==> Running remote deploy"
ssh "$VPS_HOST" "cd '$VPS_PATH' && BRANCH='$BRANCH' APP_NAME='$APP_NAME' APP_PORT='$APP_PORT' DOMAIN='$DOMAIN' bash deploy-vps.sh"

echo "==> Done"
