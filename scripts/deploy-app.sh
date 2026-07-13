#!/bin/bash
# Deploy CertBuzz to an Azure VM. Builds locally, ships via az vm run-command.
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

echo "==> Packaging app..."

# Build the tarball dry-run first to measure, then create
tar czf /tmp/certbuzz-deploy.tar.gz \
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
    .env.example

SIZE=$(stat -f%z /tmp/certbuzz-deploy.tar.gz 2>/dev/null || stat -c%s /tmp/certbuzz-deploy.tar.gz 2>/dev/null)
echo "   Tarball: ${SIZE} bytes ($(( SIZE * 4 / 3 )) estimated b64)"

TARB64=$(base64 < /tmp/certbuzz-deploy.tar.gz | tr -d '\n')

echo "==> Shipping to $VM..."
az vm run-command invoke \
    --resource-group "$RG" --name "$VM" --command-id RunShellScript \
    --output none \
    --scripts "
set -e

mkdir -p $REMOTE_DIR
cd $REMOTE_DIR

echo '${TARB64}' | base64 -d | tar xz -C $REMOTE_DIR

# Server deps
cd $REMOTE_DIR/server
npm ci --silent

cd $REMOTE_DIR

# Create .env if missing
if [ ! -f .env ]; then
    cp .env.example .env
    # Set safe defaults
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

rm -f /tmp/certbuzz-deploy.tar.gz
echo "==> Done! Visit https://$(cd "$APP_DIR/tofu" && tofu output -raw fqdn 2>/dev/null || echo '<run tofu output>')"