# CertBuzz — Azure Deployment

OpenTofu config for a single Ubuntu 24.04 VM (Node 20 + PM2 + Nginx reverse proxy with self-signed TLS). Deploys the app automatically after provisioning.

## Prerequisites

- [OpenTofu](https://opentofu.org/) >= 1.6
- [Azure CLI](https://aka.ms/installazurecliwindows) — `az login`
- SSH public key at `~/.ssh/id_rsa.pub`

## Usage

```bash
tofu init
tofu apply -var dns_name=certbuzzdemo   # provision + deploy in one shot
curl -k "$(tofu output -raw fqdn)"      # verify
tofu destroy                             # teardown
```

First run provisions infra and deploys the app. Subsequent `tofu apply` only re-deploys if VM changed. For code-only re-deploys:

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

## Notes

- Self-signed TLS. Expect browser warnings. Use `-k` with curl.
- $0.5/month B2ats_v2 in swedencentral is cheapest option.