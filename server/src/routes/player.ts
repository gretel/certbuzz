import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { queries } from '../db/queries.js';
import { getRandomEmoji } from '../utils/helpers.js';
import { io } from '../server.js';

const router = Router();

router.post('/join', (req, res) => {
  try {
    const { sessionCode, nickname } = req.body;

    if (!sessionCode || !nickname) {
      return res.status(400).json({ error: 'SessionCode und Nickname erforderlich' });
    }

    const session = queries.getSession(sessionCode);
    if (!session || session.status !== 'active') {
      return res.status(404).json({ error: 'Session nicht gefunden oder beendet' });
    }

    // Check if this nickname already exists in this session - delete old player if so
    const existingPlayer = queries.getPlayerBySessionAndNickname(sessionCode, nickname.trim());
    if (existingPlayer) {
      queries.deletePlayer(existingPlayer.playerId);
    }

    const playerId = uuidv4();
    const emoji = getRandomEmoji();

    queries.createPlayer({
      playerId,
      sessionCode,
      nickname: nickname.trim(),
      emoji,
      lastActivity: Date.now(),
    });

    // Notify dozent panel / arena of updated player list
    const players = queries.getSessionPlayers(sessionCode);
    io.to(sessionCode).emit('buzzer-players-update', {
      players: players.map(p => ({
        playerId: p.playerId,
        nickname: p.nickname,
        emoji: p.emoji,
        score: p.score,
      })),
    });

    res.json({ playerId, emoji });
  } catch (error) {
    console.error('Error joining session:', error);
    res.status(500).json({ error: 'Fehler beim Beitreten' });
  }
});

router.get('/:playerId/stats', (req, res) => {
  try {
    const { playerId } = req.params;

    const player = queries.getPlayer(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Spieler nicht gefunden' });
    }

    res.json({
      correctAnswers: player.correctAnswers,
      totalTimeSeconds: player.totalTimeSeconds,
      score: player.score,
      currentQuestion: player.currentQuestion,
    });
  } catch (error) {
    console.error('Error fetching player stats:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

export default router;
