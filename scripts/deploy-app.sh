#!/bin/bash
# Deploy CertBuzz to an Azure VM. Builds locally, ships via SSH.
#
# Usage:
#   ./scripts/deploy-app.sh "$(cd tofu && tofu output -raw resource_group)" "$(cd tofu && tofu output -raw vm_name)"
#
set -euo pipefail

if [ $# -ne 2 ]; then
    echo "Usage: $0 <resource-group> <vm-name>"
    echo ""
    echo "Example:"
    echo "  $0 \"\$(cd tofu && tofu output -raw resource_group)\" \"\$(cd tofu && tofu output -raw vm_name)\""
    exit 1
fi

RG="$1"
VM="$2"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="/home/azureuser/certbuzz"
SSH_KEY="$HOME/.ssh/id_rsa"

echo "==> Getting VM IP..."
IP=$(az vm show --resource-group "$RG" --name "$VM" --query publicIps -o tsv 2>/dev/null)
if [[ -z "$IP" ]]; then
    echo "ERROR: Could not get IP for $VM (rg: $RG)"
    echo "Try: az network public-ip list -g $RG --query '[].ip_address' -o tsv"
    exit 1
fi
echo "   VM IP: $IP"

echo "==> Building client..."
cd "$APP_DIR/client"
if [ ! -d node_modules ]; then
    npm ci --silent
fi
npm run build --silent 2>&1 | tail -3

echo "==> Building server..."
cd "$APP_DIR/server"
if [ ! -d node_modules ]; then
    npm ci --silent
fi
npm run build --silent 2>&1 | tail -3

cd "$APP_DIR"

echo "==> Shipping app to $IP..."

tar cz \
    --exclude node_modules \
    --exclude '*.db' \
    --exclude '.env' \
    server/dist \
    server/package.json \
    server/package-lock.json \
    client/dist \
    questions/ \
    package.json \
    package-lock.json \
    .env.example | ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "azureuser@$IP" "
set -e

mkdir -p $REMOTE_DIR
cd $REMOTE_DIR

# Extract
tar xz

# Server deps
cd $REMOTE_DIR/server
npm ci --silent

cd $REMOTE_DIR

# Create .env if missing
if [ ! -f .env ]; then
    cp .env.example .env
    sed -i 's/DOZENT_PASSWORD=changeme/DOZENT_PASSWORD=Dozent128/' .env
    echo 'HOST=0.0.0.0' >> .env
    echo 'NODE_ENV=production' >> .env
fi

# Restart app
pm2 delete certbuzz 2>/dev/null || true
pm2 start server/dist/server.js --name certbuzz
pm2 save

echo 'Deploy OK'
"

echo "==> Done! Visit https://${IP}/"