#!/bin/bash
# Deploy CertBuzz to an Azure VM. Polls cloud-init, provisions Let's Encrypt
# TLS cert, builds app, ships via SSH, starts PM2.
#
# Usage:
#   ./scripts/deploy-app.sh "$(cd tofu && tofu output -raw resource_group)" "$(cd tofu && tofu output -raw vm_name)"
#
set -euo pipefail

if [ $# -ne 2 ]; then
    echo "Usage: $0 <resource-group> <vm-name>"
    exit 1
fi

RG="$1"
VM="$2"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="/home/azureuser/certbuzz"
SSH_KEY="$HOME/.ssh/id_rsa"
LE_EMAIL="${LE_EMAIL:-billing@jitter.eu}"

echo "==> Getting VM IP..."
IP=$(az network public-ip list --resource-group "$RG" --query '[0].ipAddress' -o tsv 2>/dev/null)
if [[ -z "$IP" ]]; then
    echo "ERROR: Could not get public IP in resource group $RG"
    exit 1
fi
echo "   VM IP: $IP"

FQDN=$(az network public-ip list --resource-group "$RG" --query '[0].dnsSettings.fqdn' -o tsv 2>/dev/null)
if [[ -z "$FQDN" ]]; then
    echo "ERROR: Could not get FQDN"
    exit 1
fi
echo "   FQDN: $FQDN"

echo "==> Waiting for cloud-init..."
CLOUD_INIT_DONE=false
for _ in $(seq 1 60); do
    if ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes "azureuser@$IP" "cloud-init status --wait 2>/dev/null; echo READY" 2>/dev/null | grep -q READY; then
        CLOUD_INIT_DONE=true
        echo "   cloud-init done"
        break
    fi
    echo "   still waiting..."
    sleep 5
done
if [ "$CLOUD_INIT_DONE" != "true" ]; then
    echo "ERROR: cloud-init did not complete within timeout"
    exit 1
fi

echo "==> Provisioning Let's Encrypt TLS cert..."
if ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "azureuser@$IP" "sudo certbot certificates 2>/dev/null | grep -q '$FQDN'"; then
    echo "   cert already exists, skipping"
else
    echo "   requesting cert for $FQDN ..."
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "azureuser@$IP" \
        "sudo certbot --nginx -d '$FQDN' --non-interactive --agree-tos --email '$LE_EMAIL' 2>&1" || {
        echo "   Let's Encrypt failed, falling back to self-signed cert"
    }
fi

echo "==> Building client..."
cd "$APP_DIR/client"
if [ ! -d node_modules ]; then npm ci --silent; fi
npm run build --silent 2>&1 | tail -3

echo "==> Building server..."
cd "$APP_DIR/server"
if [ ! -d node_modules ]; then npm ci --silent; fi
npm run build --silent 2>&1 | tail -3

cd "$APP_DIR"

echo "==> Shipping app to $IP..."

tar cz \
    --exclude node_modules \
    --exclude '*.db' \
    --exclude '.env' \
    server/dist server/package.json server/package-lock.json \
    client/dist \
    questions/ \
    package.json package-lock.json .env.example \
    | ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "azureuser@$IP" "
set -e
mkdir -p $REMOTE_DIR && cd $REMOTE_DIR
tar xz

cd $REMOTE_DIR/server && npm ci --silent
cd $REMOTE_DIR

if [ ! -f .env ]; then
    cp .env.example .env
fi
sed -i 's/DOZENT_PASSWORD=changeme/DOZENT_PASSWORD=Dozent128/' .env
sed -i 's|# ALLOWED_ORIGINS=https://your-domain.com|ALLOWED_ORIGINS=https://'"${FQDN}"'|' .env
sed -i 's/^PORT=8000/PORT=8000/' .env
grep -q '^HOST=' .env || echo 'HOST=0.0.0.0' >> .env
grep -q '^NODE_ENV=' .env || echo 'NODE_ENV=production' >> .env

pm2 delete certbuzz 2>/dev/null || true
pm2 start server/dist/server.js --name certbuzz
pm2 save
echo 'Deploy OK'
"

echo "==> Done! Visit https://${FQDN}/"