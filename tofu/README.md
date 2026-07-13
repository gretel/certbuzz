# CertBuzz — Azure Deployment

OpenTofu configuration to provision a single Ubuntu 24.04 VM on Azure
with Node.js 20, PM2, Nginx (reverse proxy with self-signed TLS), then
deploy the CertBuzz app on top.

## Prerequisites

- [OpenTofu](https://opentofu.org/) >= 1.6
- [Azure CLI](https://aka.ms/installazurecliwindows) — logged in: `az login`
- SSH public key at `~/.ssh/id_rsa.pub`

## Quick start

```bash
# 1. Provision infra
tofu init
tofu apply -var dns_name=certbuzzdemo

# 2. Wait ~3 min for cloud-init to finish, then deploy the app
../scripts/deploy-app.sh "$(tofu output -raw resource_group)" "$(tofu output -raw vm_name)"

# 3. Verify
curl -k "$(tofu output -raw fqdn)"

# 4. Destroy when done
tofu destroy
```

## First-time deploy notes

1. `tofu apply` creates: resource group, VNet, subnet, public IP with DNS label,
   NSG (22/80/443), and an Ubuntu 24.04 VM.
2. Cloud-init (cloud-init.tftpl) installs Node 20, PM2, Nginx, creates a
   self-signed TLS cert, and configures Nginx as a reverse proxy to port 8000.
3. `deploy-app.sh` builds the app locally (client + server), ships a tarball
   via `az vm run-command`, installs deps, and starts PM2.

## Updating the app after initial deploy

```bash
../scripts/deploy-app.sh "$(tofu output -raw resource_group)" "$(tofu output -raw vm_name)"
```

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `dns_name` | `"certbuzz"` | DNS label prefix |
| `location` | `"polandcentral"` | Azure region |
| `vm_size` | `"Standard_B2ls_v2"` | VM SKU |
| `ssh_public_key_path` | `"~/.ssh/id_rsa.pub"` | SSH key |

## Outputs

| Name | Description |
|------|-------------|
| `fqdn` | Full HTTPS URL |
| `public_ip` | Public IP address |
| `resource_group` | Azure resource group |
| `vm_name` | VM name (for deploy script) |
| `ssh` | SSH command |

## Self-signed TLS

The VM uses a self-signed cert. Expect browser warnings. Use `-k` with curl.
For a real certificate switch cloud-init to use certbot.

## Caveats

- `az vm run-command` has a ~256 KB script limit. The app tarball must fit.
  Client build is ~200 KB uncompressed, < 80 KB gzipped — safe.
- B2ls_v2 is burstable. Under sustained load CPU credits drain.
  Monitor with `az vm list-sizes` if needed.