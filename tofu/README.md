# CertBuzz — Azure Deployment

OpenTofu config for a single Ubuntu 24.04 VM (Node 20 + PM2 + Nginx).
Auto-provisions infra and deploys app. TLS via Let's Encrypt (certbot).

## Prerequisites

- [OpenTofu](https://opentofu.org/) >= 1.6
- [Azure CLI](https://aka.ms/installazurecliwindows) — `az login`
- SSH public key at `~/.ssh/id_rsa.pub`

## Usage

```bash
tofu init
tofu apply -var dns_name=certbuzzdemo   # provision + deploy + LE cert
curl "$(tofu output -raw fqdn)"         # verify
tofu destroy                             # teardown
```

Re-deploy after code changes:

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

Set `LE_EMAIL` env var to override the default Let's Encrypt registration email.

## Notes

- Let's Encrypt certs auto-renew via systemd timer.
- Fallback to self-signed if certbot fails.
- B2ats_v2 in swedencentral ~$0.50/mo.
