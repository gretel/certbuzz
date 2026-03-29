import { useEffect, useState } from 'react';

interface LeaderboardEntry {
  nickname: string;
  emoji: string;
  totalScore: number;
  totalCorrect: number;
  sessionsPlayed: number;
}

export function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch('/api/leaderboard');
      if (!response.ok) {
        throw new Error('Rangliste nicht gefunden');
      }
      const data = await response.json();
      setLeaderboard(data.leaderboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();

    // Refresh every 10 seconds
    const interval = setInterval(fetchLeaderboard, 10000);
    return () => clearInterval(interval);
  }, []);

  const maxScore = leaderboard.length > 0 ? Math.max(...leaderboard.map(e => e.totalScore)) : 1;

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-azure-dark to-gray-900 flex items-center justify-center">
        <div className="text-2xl font-semibold text-white/70">
          Laden...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-azure-dark to-gray-900 flex items-center justify-center">
        <div className="text-2xl font-semibold text-red-400">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-azure-dark to-gray-900 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-black text-white mb-2">
            AZURELYMPICS
          </h1>
          <p className="text-xl text-azure-light">
            Gesamt-Rangliste
          </p>
        </div>

        {/* Leaderboard */}
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-6">
          {leaderboard.length === 0 ? (
            <div className="text-center text-white/50 text-xl py-12">
              Noch keine Spieler
            </div>
          ) : (
            <div className="space-y-3">
              {leaderboard.map((entry, index) => {
                const width = maxScore > 0 ? (entry.totalScore / maxScore) * 100 : 0;
                const position = index + 1;

                const getPositionStyle = (pos: number) => {
                  if (pos === 1) return { gradient: 'from-yellow-400 to-yellow-500', badge: 'bg-yellow-400 text-yellow-900' };
                  if (pos === 2) return { gradient: 'from-gray-300 to-gray-400', badge: 'bg-gray-300 text-gray-700' };
                  if (pos === 3) return { gradient: 'from-orange-400 to-orange-500', badge: 'bg-orange-300 text-orange-900' };
                  return { gradient: 'from-azure-blue to-azure-light', badge: 'bg-white/10 text-white/60' };
                };

                const style = getPositionStyle(position);

                return (
                  <div key={entry.nickname} className="relative transition-all duration-500 ease-out">
                    {/* Nickname + Position */}
                    <div className="flex items-center justify-between mb-1 px-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${style.badge}`}>
                          {position}
                        </span>
                        <span className="text-2xl">{entry.emoji}</span>
                        <span className="text-lg font-medium text-white truncate max-w-[200px]">
                          {entry.nickname}
                        </span>
                      </div>
                      <span className="text-lg font-bold text-azure-light">
                        {Math.round(entry.totalScore)} pts
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="relative h-12 bg-white/10 rounded-full overflow-hidden border border-white/20">
                      <div
                        className={`absolute h-full bg-gradient-to-r ${style.gradient} transition-all duration-700 ease-out shadow-lg`}
                        style={{ width: `${Math.min(width, 100)}%` }}
                      />

                      {/* Stats overlay */}
                      <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
                        <span className="text-xs font-medium text-white/60">
                          {entry.totalCorrect} richtige Antworten
                        </span>
                        <span className="text-xs font-medium text-white/60">
                          {entry.sessionsPlayed} {entry.sessionsPlayed === 1 ? 'Runde' : 'Runden'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Back Link */}
        <div className="text-center mt-6">
          <a
            href="/"
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/10 text-white font-medium py-3 px-6 rounded-xl transition-all"
          >
            Zur Startseite
          </a>
        </div>
      </div>
    </div>
  );
}
