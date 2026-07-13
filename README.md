# CertBuzz

Real-time multiplayer quiz system for IT certification exam preparation. Supports multiple question banks (Azure AZ-104, AWS CLF-C02, and more).

## Features

- **Multi-bank support**: Load question banks from JSON files — add new certifications by dropping a file in `questions/`
- **Two game modes**: Racing (self-paced) and Buzzer (competitive, instructor-led)
- **Live leaderboard**: Real-time scoring with WebSocket updates
- **Arena view**: Projector-friendly spectator mode for buzzer sessions
- **Instructor panel**: Password-protected admin panel for session management

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Socket.io-client
- **Backend**: Node.js, Express, Socket.io, sql.js (SQLite)

## Quick Start

```bash
# Install dependencies
npm run install:all

# Configure environment
cp .env.example .env
# Edit .env: set DOZENT_PASSWORD

# Development
npm run dev

# Production build
cd client && npm run build
cd ../server && npm start
```

## URLs

| Route | Description |
|-------|-------------|
| `/` | Player lobby |
| `/dozent` | Instructor panel (password protected) |
| `/session/:code` | Game session |
| `/arena/:code` | Buzzer arena view (for projector) |
| `/leaderboard` | Aggregate leaderboard |

## Game Modes

- **Racing**: Players answer at their own pace, compete on speed + accuracy
- **Buzzer**: First to buzz gets to answer, wrong answers pass to next buzzer

## Question Banks

Question banks live in `questions/` as JSON files. Each file is a bank (e.g., `azure-az104.json`). Add new banks by creating new JSON files following the same schema.

Bank metadata (labels, category icons) is configured in `server/src/questions/questionBank.ts`.

## Environment Variables

```bash
PORT=8000
DOZENT_PASSWORD=your_password
ALLOWED_ORIGINS=https://your-domain.com
```

## Project Structure

```
├── client/           # React frontend (Vite + Tailwind)
│   └── src/
│       ├── components/
│       ├── hooks/
│       └── pages/
├── server/           # Express + Socket.io backend
│   └── src/
│       ├── db/
│       ├── questions/
│       ├── routes/
│       └── socket/
├── tofu/             # OpenTofu: Azure infra as code
│   ├── main.tf       #   Resource group, VNet, NSG, VM
│   ├── outputs.tf    #   FQDN, IP, SSH command
│   ├── variables.tf
│   └── cloud-init.tftpl
├── scripts/          # Deployment helpers
│   ├── deploy-app.sh #   Build + ship app to Azure VM
│   └── tofu-apply.sh #   One-shot tofu init + apply
├── questions/        # Question bank JSON files
│   ├── azure-az104.json
│   └── clf-c02-complete.json
└── docs/
    └── legacy/       # Historical AWS deployment scripts
```

## Deploy to Azure

Prerequisites: [OpenTofu](https://opentofu.org/), [Azure CLI](https://aka.ms/installazurecliwindows) (logged in with `az login`), and an SSH public key at `~/.ssh/id_rsa.pub`.

```bash
# 1. Provision Azure VM
cd tofu
tofu init
tofu apply -var dns_name=certbuzzdemo

# 2. Deploy app (after VM is ready, ~3 min for cloud-init)
cd ..
./scripts/deploy-app.sh "$(cd tofu && tofu output -raw resource_group)" "$(cd tofu && tofu output -raw vm_name)"

# 3. Open in browser
open "$(cd tofu && tofu output -raw fqdn)"

# Tear down
tofu destroy
```

See [`tofu/README.md`](tofu/README.md) for full details.
