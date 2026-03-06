#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-_}"
APP_DIR="${APP_DIR:-/var/www/cubic}"
APP_NAME="${APP_NAME:-cubic}"
APP_PORT="${APP_PORT:-3002}"

echo "==> Installing system packages"
apt-get update -qq
apt-get install -y -qq nginx curl ca-certificates gnupg

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 20"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing pm2"
  npm install -g pm2
fi

echo "==> Preparing application directory"
mkdir -p "$APP_DIR"

echo "==> Writing nginx config"
cat > /etc/nginx/sites-available/"$APP_NAME" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    root $APP_DIR/dist;
    index index.html;

    location /ws {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;
}
NGINX

ln -sf /etc/nginx/sites-available/"$APP_NAME" /etc/nginx/sites-enabled/"$APP_NAME"
rm -f /etc/nginx/sites-enabled/default

echo "==> Validating nginx config"
nginx -t

echo "==> Enabling services"
systemctl enable nginx
systemctl restart nginx
pm2 startup systemd -u "$(id -un)" --hp "$HOME" >/tmp/pm2-startup.txt || true

echo "==> Done"
echo "    App dir: $APP_DIR"
echo "    Nginx site: /etc/nginx/sites-available/$APP_NAME"
echo "    Next step from local machine:"
echo "      VPS_HOST=root@your-vps VPS_PATH=$APP_DIR APP_NAME=$APP_NAME APP_PORT=$APP_PORT ./deploy.sh"
