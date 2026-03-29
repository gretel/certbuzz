import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase } from './db/schema.js';
import { setupSocketHandlers } from './socket/events.js';
import dozentRoutes from './routes/dozent.js';
import playerRoutes from './routes/player.js';
import sessionRoutes from './routes/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = express();
const httpServer = createServer(app);

// Build allowed origins list from environment
const PORT = parseInt(process.env.PORT || '8000');
const isDevelopment = process.env.NODE_ENV !== 'production';

const allowedOrigins = [
  'http://localhost:5173', // Vite dev server
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  // Add custom origins from .env if provided
  ...(process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || []),
];

export const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);

      // Strip protocol for comparison (allow both http:// and https://)
      const originLower = origin.toLowerCase();
      const originWithoutProtocol = originLower.replace(/^https?:\/\//, '');

      const isAllowed = allowedOrigins.some(allowed => {
        const allowedWithoutProtocol = allowed.toLowerCase().replace(/^https?:\/\//, '');
        return originWithoutProtocol === allowedWithoutProtocol;
      }) || origin.match(/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/);

      if (isAllowed) {
        callback(null, true);
      } else {
        console.error(`Socket.io CORS blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    // Check if origin matches allowed origins or local network
    const originLower = origin.toLowerCase();
    // Strip protocol for comparison (allow both http:// and https://)
    const originWithoutProtocol = originLower.replace(/^https?:\/\//, '');

    const isAllowed = allowedOrigins.some(allowed => {
      const allowedWithoutProtocol = allowed.toLowerCase().replace(/^https?:\/\//, '');
      return originWithoutProtocol === allowedWithoutProtocol;
    }) || origin.match(/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/);

    if (isAllowed) {
      callback(null, true);
    } else {
      console.error(`CORS blocked origin: ${origin}`);
      console.error(`Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  // Sanitize URL to redact password parameter
  const sanitizedUrl = req.url.replace(/([?&])password=[^&]*/gi, '$1password=***');
  console.log(`[${timestamp}] ${req.method} ${sanitizedUrl} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// Initialize database and start server
await initializeDatabase();

// API Routes (BEFORE static files!)
app.use('/api/dozent', dozentRoutes);
app.use('/api/player', playerRoutes);
app.use('/api/session', sessionRoutes);

// Import queries for public sessions endpoint
import { queries } from './db/queries.js';
import { getAvailableBanks } from './questions/questionBank.js';

// Public sessions endpoint (no auth required - for players to browse available sessions)
app.get('/api/sessions', (req, res) => {
  try {
    const sessions = queries.getAllSessions();
    const banks = getAvailableBanks();
    const bankLabels = Object.fromEntries(banks.map(b => [b.bankId, b.label]));
    const activeSessions = sessions
      .filter((s: { status: string }) => s.status === 'active')
      .map((s: any) => ({ ...s, questionBankLabel: bankLabels[s.questionBank] || s.questionBank }));
    res.json({ sessions: activeSessions });
  } catch (error) {
    console.error('Error fetching public sessions:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Sessions' });
  }
});

// Aggregate leaderboard endpoint (public - shows cumulative scores across all sessions)
app.get('/api/leaderboard', (req, res) => {
  try {
    const leaderboard = queries.getAggregateLeaderboard();
    res.json({ leaderboard });
  } catch (error) {
    console.error('Error fetching aggregate leaderboard:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Leaderboards' });
  }
});

// Health check endpoints
app.get('/alive', (req, res) => {
  res.status(200).send('OK');
});

app.get('/api', (req, res) => {
  res.json({
    status: 'ok',
    name: 'CertBuzz API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Serve static React build in production
if (!isDevelopment) {
  const clientBuildPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientBuildPath));

  // Catch-all: Serve index.html for React Router (SPA)
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else {
  // Development: Show helpful message
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="de">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CertBuzz Server</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #4F46E5 0%, #312E81 100%);
            color: white;
          }
          .container {
            text-align: center;
            padding: 2rem;
          }
          h1 { font-size: 3rem; margin: 0 0 1rem 0; }
          p { font-size: 1.25rem; margin: 0.5rem 0; opacity: 0.9; }
          .status { color: #818CF8; font-weight: bold; }
          a { color: #818CF8; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎓 CertBuzz</h1>
          <p class="status">Server läuft im Dev-Modus!</p>
          <p>Öffne den Client auf <a href="http://localhost:5173">http://localhost:5173</a></p>
          <p style="font-size: 0.9rem; opacity: 0.7; margin-top: 2rem;">
            API: <a href="/api">/api</a>
          </p>
        </div>
      </body>
      </html>
    `);
  });
}

setupSocketHandlers(io);

// Error handling middleware (must be last)
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${err.message}`);
  console.error(`[${timestamp}] Stack: ${err.stack}`);
  console.error(`[${timestamp}] Request: ${req.method} ${req.url}`);
  console.error(`[${timestamp}] Origin: ${req.headers.origin}`);

  res.status(500).json({
    error: isDevelopment ? err.message : 'Internal server error',
    timestamp
  });
});

const HOST = process.env.HOST || '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Server starting...`);
  console.log(`[${new Date().toISOString()}] Mode: ${isDevelopment ? 'DEVELOPMENT' : 'PRODUCTION'}`);
  console.log(`[${new Date().toISOString()}] Server running on http://${HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log(`[${new Date().toISOString()}]    Local: http://localhost:${PORT}`);
    console.log(`[${new Date().toISOString()}]    Network: http://<your-ip>:${PORT}`);
  }
  console.log(`[${new Date().toISOString()}] Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`[${new Date().toISOString()}] 🎓 CertBuzz is ready!`);
});
