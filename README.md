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
├── client/           # React frontend
│   └── src/
│       ├── components/
│       ├── hooks/
│       └── pages/
├── server/           # Express backend
│   └── src/
│       ├── db/
│       ├── questions/   # Question bank loader
│       ├── routes/
│       └── socket/
└── questions/        # Question bank JSON files
    └── azure-az104.json
```
