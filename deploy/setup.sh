#!/usr/bin/env bash
# One-time server setup for Ubuntu 24.04. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/rissole/guild-bridge/main/deploy/setup.sh | bash
# Then put the settings in /opt/guild-bridge/.env and: systemctl restart guild-bridge
set -euo pipefail

REPO=https://github.com/rissole/guild-bridge.git
DIR=/opt/guild-bridge

export DEBIAN_FRONTEND=noninteractive

# Swap: npm install can run out of memory on a 512 MB server.
if ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update -q
apt-get install -yq ca-certificates curl git ufw
if ! node --version 2>/dev/null | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -yq nodejs
fi

# Firewall: the bot only makes outbound connections; allow SSH in, nothing else.
ufw allow OpenSSH
ufw --force enable

id bridge &>/dev/null || useradd --system --home "$DIR" --shell /usr/sbin/nologin bridge
git config --global --add safe.directory "$DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi
(cd "$DIR" && npm ci --omit=dev)
touch "$DIR/.env"
chown -R bridge:bridge "$DIR"
chmod 600 "$DIR/.env"

cp "$DIR/deploy/guild-bridge.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable guild-bridge
echo "Setup done. Fill in $DIR/.env, then: systemctl restart guild-bridge"
