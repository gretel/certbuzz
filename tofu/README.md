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
tofu output -raw dozent_password        # show dozent panel password
tofu destroy                             # teardown
```

### Outputs

| Output | Description |
|--------|-------------|
| `fqdn` | Full URL (https://...) |
| `public_ip` | VM public IP |
| `resource_group` | Azure resource group (for re-deploy) |
| `vm_name` | VM name (for re-deploy) |
| `dozent_password` | Random 24-char password for /dozent panel (sensitive) |
| `ssh` | SSH command |

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

## Database persistence

The SQLite database is stored in `~/certbuzz-data/database.db` (a directory outside the app tree
that is never touched by code deployments). The deploy script:

1. Backs up the existing database to `~/certbuzz-data/` before extracting new code
2. Restores it after extraction if missing
3. Configures `DATABASE_PATH` in `.env` so the server always finds it

Player scores, exam progress, and session data survive re-deploys.

## Random password

On each deploy, `tofu` generates a random 24-character `DOZENT_PASSWORD` via the `random_password`
resource. The password is written to `~/.env` on the VM and exposed as a (sensitive) tofu output.
When running `deploy-app.sh` directly (without tofu), the script generates a password via `openssl`.

## Notes

- Let's Encrypt certs auto-renew via systemd timer.
- Fallback to self-signed if certbot fails.
- B2ats_v2 in swedencentral ~$0.50/mo.
