# Azurelympics-104

Real-time multiplayer quiz system for Microsoft AZ-104 certification exam preparation.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Socket.io-client
- **Backend**: Node.js, Express, Socket.io, sql.js (SQLite)

## Quick Start

```bash
# Install dependencies
cd server && npm install
cd ../client && npm install

# Configure environment
cp .env.example .env
# Edit .env: set DOZENT_PASSWORD

# Development (run both in separate terminals)
cd server && npm run dev
cd client && npm run dev

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
│       ├── routes/
│       └── socket/
└── questions.json    # Quiz questions
```
