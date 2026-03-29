import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../hooks/useSocket';

interface Session {
  sessionCode: string;
  createdAt: number;
  status: 'active' | 'finished';
  totalQuestions: number;
  playerCount: number;
  gameMode: 'racing' | 'buzzer' | 'training';
  gameState: string;
  questionBank: string;
  questionBankLabel: string;
}

export function Home() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/sessions');
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();

    // Poll as fallback
    const interval = setInterval(fetchSessions, 10000);

    // Instant refresh when a session is created or deleted
    const socket = getSocket();
    const refresh = () => fetchSessions();
    socket?.on('sessions-changed', refresh);

    return () => {
      clearInterval(interval);
      socket?.off('sessions-changed', refresh);
    };
  }, [fetchSessions]);

  const formatTimeAgo = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    if (hours > 0) return `vor ${hours}h`;
    if (minutes > 0) return `vor ${minutes}min`;
    return 'gerade eben';
  };

  const getStateLabel = (state: string) => {
    switch (state) {
      case 'lobby': return 'Wartet auf Start';
      case 'question':
      case 'answering':
      case 'result':
      case 'transition': return 'Läuft gerade';
      case 'finished': return 'Beendet';
      default: return state;
    }
  };

  const activeSessions = sessions.filter(s => s.status === 'active' && s.gameState !== 'finished');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-black text-white mb-2">
            CERTBUZZ
          </h1>
          <p className="text-xl text-cb-accent">
            Certification Quiz Challenge
          </p>
        </div>

        {/* Sessions Card */}
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-6 mb-6">
          <h2 className="text-xl font-bold text-white mb-4 text-center">
            Session beitreten
          </h2>

          {loading ? (
            <div className="py-8 text-center text-white/60">
              <div className="animate-spin h-8 w-8 border-4 border-cb-accent border-t-transparent rounded-full mx-auto mb-3"></div>
              Lade Sessions...
            </div>
          ) : activeSessions.length === 0 ? (
            <div className="py-8 text-center">
              <div className="text-5xl mb-3">🎮</div>
              <p className="text-white/80">Keine aktiven Sessions</p>
              <p className="text-white/40 text-sm mt-1">Warte auf den Dozenten...</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeSessions.map((session) => (
                <button
                  key={session.sessionCode}
                  onClick={() => navigate(`/session/${session.sessionCode}`)}
                  className="w-full p-4 bg-white/10 hover:bg-white/20 border border-white/10 hover:border-cb-accent/50 rounded-2xl transition-all text-left group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">
                        {session.gameMode === 'buzzer' ? '🔔' : '🏎️'}
                      </span>
                      <div>
                        <code className="text-2xl font-mono font-black text-white group-hover:text-cb-accent transition-colors">
                          {session.sessionCode}
                        </code>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                            session.gameState === 'lobby' 
                              ? 'bg-green-500/20 text-green-300'
                              : 'bg-yellow-500/20 text-yellow-300'
                          }`}>
                            {getStateLabel(session.gameState)}
                          </span>
                          <span className="text-xs text-white/50">
                            {session.gameMode === 'buzzer' ? 'Buzzer-Modus' : session.gameMode === 'training' ? 'Team Training' : 'Racing-Modus'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-cb-accent">
                        {session.playerCount}
                      </div>
                      <div className="text-xs text-white/50">Spieler</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-white/40 mt-1">
                    <span>{session.questionBankLabel} · {session.totalQuestions} Fragen</span>
                    <span>{formatTimeAgo(session.createdAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer Links */}
        <div className="flex justify-center gap-4">
          <a
            href="/leaderboard"
            className="inline-flex items-center gap-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-400/30 text-yellow-300 font-medium py-3 px-6 rounded-xl transition-all"
          >
            <span>🏆</span>
            <span>Rangliste</span>
          </a>
          <a
            href="/dozent"
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/10 text-white font-medium py-3 px-6 rounded-xl transition-all"
          >
            <span>Dozenten-Bereich</span>
            <span>👨‍🏫</span>
          </a>
        </div>
      </div>
    </div>
  );
}
