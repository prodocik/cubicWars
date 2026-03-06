#!/usr/bin/env bash
set -euo pipefail

# Run on VPS as root: curl -sL <url> | bash
# Or: ssh root@your-vps 'bash -s' < setup-vps.sh

DOMAIN="${1:-}"
GAME_DIR="/var/www/game"

echo "==> Installing nginx..."
apt-get update -qq
apt-get install -y -qq nginx

echo "==> Creating game directory..."
mkdir -p "$GAME_DIR"

echo "==> Writing nginx config..."
if [ -n "$DOMAIN" ]; then
  SERVER_NAME="$DOMAIN"
else
  SERVER_NAME="_"
fi

cat > /etc/nginx/sites-available/game <<NGINX
server {
    listen 80;
    server_name $SERVER_NAME;

    root $GAME_DIR;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;
}
NGINX

ln -sf /etc/nginx/sites-available/game /etc/nginx/sites-enabled/game
rm -f /etc/nginx/sites-enabled/default

echo "==> Testing nginx config..."
nginx -t

echo "==> Restarting nginx..."
systemctl enable nginx
systemctl restart nginx

echo "==> Done!"
echo "    Game dir: $GAME_DIR"
echo "    Now run: VPS_HOST=root@your-vps ./deploy.sh"
if [ -n "$DOMAIN" ]; then
  echo "    Site: http://$DOMAIN"
  echo ""
  echo "    For HTTPS, install certbot:"
  echo "      apt install certbot python3-certbot-nginx"
  echo "      certbot --nginx -d $DOMAIN"
fi
