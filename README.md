# CertBuzz

Real-time multiplayer quiz for IT certification prep. Supports Azure AZ-104, AWS CLF-C02.

## Tech

React + Vite + Tailwind + Socket.io | Node + Express + sql.js (SQLite)

## Quick Start

```bash
npm run install:all
cp .env.example .env   # set DOZENT_PASSWORD (or auto-generated on deploy)
npm run dev             # dev mode (server :8000, client :5173)
npm run build && npm start  # production
```

## Game Modes

| Mode | Description |
|------|-------------|
| Racing | Self-paced, compete on speed + accuracy. Points: +1000 per correct answer, -1 per second, -60s penalty per wrong answer. |
| Buzzer | Instructor-led, first to buzz answers. Multiple-choice elimination only crosses out actually wrong answers (not all selected). |
| Team Training | Collaborative mode: vote on answers with confidence grid. |
| Exam Simulation | Timed certification simulation. Scaled scoring (100–1000), per-domain breakdown, resumable. |

## Routes

| Route | Description |
|-------|-------------|
| `/` | Player lobby |
| `/dozent` | Instructor panel (`DOZENT_PASSWORD` required) |
| `/session/:code` | Game session (Racing / Buzzer / Training / Exam) |
| `/arena/:code` | Buzzer arena / Dozent projection view |
| `/leaderboard` | Aggregate leaderboard across sessions |

## Question Banks

JSON files in `questions/`. Add new certs by dropping a file. Bank metadata in `server/src/questions/questionBank.ts`.

### Azure AZ-104 (April 2026)
- 104 questions across 5 domains (Identity 25%, Storage 18%, Compute 25%, Networking 20%, Monitoring 12%)
- 60-question exam simulation, 100 minutes, pass 700/1000
- Covers App Service, encryption at host, backup/recovery

### AWS CLF-C02
- 65-question exam simulation, 90 minutes, pass 700/1000
- 4 domains (Concepts 24%, Security 30%, Tech 34%, Billing 12%)

## Deploy to Azure

```bash
cd tofu && tofu init && tofu apply -var dns_name=certbuzzdemo  # provision + deploy
tofu destroy  # teardown
```

Each deploy generates a random `DOZENT_PASSWORD` (24 chars). Retrieve it:
```bash
tofu output -raw dozent_password
```

Re-deploy after code changes:
```bash
./scripts/deploy-app.sh "$(tofu output -raw resource_group)" "$(tofu output -raw vm_name)"
```

### Database persistence

The SQLite database lives in `~/certbuzz-data/` on the VM — outside the app directory. Deployments automatically back up and restore it, so player scores and exam progress survive re-deploys.

See [`tofu/README.md`](tofu/README.md) for full deployment docs.