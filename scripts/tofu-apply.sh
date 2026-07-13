#!/bin/bash
# One-shot: tofu init + apply with sensible defaults.
#
# Usage:
#   ./scripts/tofu-apply.sh [dns-name]
#
# If dns-name omitted, uses "certbuzz" (auto-suffixed with random 6 chars).
set -euo pipefail

DNS="${1:-certbuzz}"
DIR="$(cd "$(dirname "$0")/../tofu" && pwd)"

cd "$DIR"

echo "==> tofu init"
tofu init

echo "==> tofu apply -var dns_name=$DNS"
tofu apply -var "dns_name=$DNS"

echo ""
echo "==> Outputs:"
tofu output

echo ""
echo "==> Next step:"
echo "   ./scripts/deploy-app.sh \"$(tofu output -raw resource_group)\" \"$(tofu output -raw vm_name)\""