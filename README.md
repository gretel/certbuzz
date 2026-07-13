# CertBuzz

Real-time multiplayer quiz for IT cert prep. Supports Azure AZ-104, AWS CLF-C02, more.

## Tech

React + Vite + Tailwind + Socket.io | Node + Express + sql.js (SQLite)

## Quick Start

```bash
npm run install:all
cp .env.example .env   # set DOZENT_PASSWORD
npm run dev             # dev mode (server :8000, client :5173)
npm run build && npm start  # production
```

## Game Modes

| Mode | Description |
|------|-------------|
| Racing | Self-paced, compete on speed + accuracy |
| Buzzer | Instructor-led, first to buzz answers |
| Team Training | Collaborative team mode |
| Exam Simulation | Timed certification simulation |

## Routes

| Route | Description |
|-------|-------------|
| `/` | Player lobby |
| `/dozent` | Instructor panel |
| `/session/:code` | Game session |
| `/arena/:code` | Buzzer arena |
| `/leaderboard` | Rankings |

## Question Banks

JSON files in `questions/`. Add new certs by dropping a file. Bank metadata in `server/src/questions/questionBank.ts`.

## Deploy to Azure

```bash
cd tofu && tofu init && tofu apply -var dns_name=certbuzzdemo  # provision
./scripts/deploy-app.sh "$(tofu output -raw resource_group)" "$(tofu output -raw vm_name)"  # deploy
tofu destroy  # teardown
```

See [`tofu/README.md`](tofu/README.md) for details.