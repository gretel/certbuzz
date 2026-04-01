import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSocket } from '../hooks/useSocket';
import { ParticleEffects } from '../components/effects/ParticleEffects';
import { computeDenseRanks, getRankStyle } from '../utils/ranking';

interface Question {
  id: string;
  category: string;
  type: 'single' | 'multiple' | 'order';
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  options: Array<{ id: string; text: string }>;
}

interface BuzzEntry {
  position: number;
  nickname: string;
  emoji: string;
  buzzTime: number;
  playerId?: string;
}

interface LeaderboardEntry {
  nickname: string;
  emoji: string;
  score: number;
  correct_answers: number;
  playerId?: string;
}

interface Answerer {
  playerId: string;
  nickname: string;
  emoji: string;
  buzzTime?: number;
}

type GamePhase = 'lobby' | 'question' | 'enrolling' | 'answering' | 'result' | 'transition' | 'finished';

// QR Code component
function QRCode({ url, size = 200 }: { url: string; size?: number }) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;
  return (
    <img 
      src={qrUrl} 
      alt="QR Code" 
      width={size} 
      height={size}
      className="rounded-xl"
    />
  );
}

export function BuzzerArena() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const socket = getSocket();
  const sessionUrl = `${window.location.origin}/session/${code}`;
  const [sessionDeleted, setSessionDeleted] = useState(false);

  // Game state
  const [gamePhase, setGamePhase] = useState<GamePhase>('lobby');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [buzzes, setBuzzes] = useState<BuzzEntry[]>([]);
  const [currentAnswerer, setCurrentAnswerer] = useState<Answerer | null>(null);
  const [currentAnswererIndex, setCurrentAnswererIndex] = useState(-1);
  const [eliminatedAnswers, setEliminatedAnswers] = useState<string[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [players, setPlayers] = useState<Array<{ playerId: string; nickname: string; emoji: string }>>([]);

  // Live selection from answerer (for Dozent assistance)
  const [liveSelection, setLiveSelection] = useState<string[]>([]);

  // Timing
  const [buzzStartTime, setBuzzStartTime] = useState(0);
  const [enrollmentStartTime, setEnrollmentStartTime] = useState(0);
  const [answerStartTime, setAnswerStartTime] = useState(0);
  const [buzzTimeoutMs, setBuzzTimeoutMs] = useState(40000);
  const [enrollmentTimeoutMs, setEnrollmentTimeoutMs] = useState(10000);
  const [answerTimeoutMs, setAnswerTimeoutMs] = useState(40000);
  const [transitionStartTime, setTransitionStartTime] = useState(0);
  const [buzzTimeRemaining, setBuzzTimeRemaining] = useState(40);
  const [enrollmentTimeRemaining, setEnrollmentTimeRemaining] = useState(10);
  const [answerTimeRemaining, setAnswerTimeRemaining] = useState(40);
  const [transitionTimeRemaining, setTransitionTimeRemaining] = useState(20);

  // Result state
  const [lastResult, setLastResult] = useState<{
    correct: boolean;
    answerer?: Answerer;
    correctAnswers?: string[];
    explanation?: string;
    references?: string[];
    pointsAwarded?: number;
    basePoints?: number;
    speedBonus?: number;
    noBuzzes?: boolean;
    noMoreBuzzers?: boolean;
  } | null>(null);

  // Timer updates
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (gamePhase === 'question' && buzzStartTime > 0) {
        const remaining = Math.max(0, (buzzTimeoutMs - (now - buzzStartTime)) / 1000);
        setBuzzTimeRemaining(remaining);
      }
      if (gamePhase === 'enrolling' && enrollmentStartTime > 0) {
        const remaining = Math.max(0, (enrollmentTimeoutMs - (now - enrollmentStartTime)) / 1000);
        setEnrollmentTimeRemaining(remaining);
      }
      if (gamePhase === 'answering' && answerStartTime > 0) {
        const remaining = Math.max(0, (answerTimeoutMs - (now - answerStartTime)) / 1000);
        setAnswerTimeRemaining(remaining);
      }
      if (gamePhase === 'transition' && transitionStartTime > 0) {
        const remaining = Math.max(0, (20000 - (now - transitionStartTime)) / 1000);
        setTransitionTimeRemaining(remaining);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [gamePhase, buzzStartTime, enrollmentStartTime, answerStartTime, transitionStartTime, buzzTimeoutMs, enrollmentTimeoutMs, answerTimeoutMs]);

  // Fetch session info
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch(`/api/session/${code}`);
        if (response.ok) {
          const data = await response.json();
          setTotalQuestions(data.totalQuestions);
        }
      } catch (err) {
        console.error('Failed to fetch session:', err);
      }
    };
    if (code) fetchSession();
  }, [code]);

  // Socket event handlers
  useEffect(() => {
    if (!socket || !code) return;

    // Join session as spectator
    socket.emit('arena-join', code);

    // Request initial state
    socket.emit('buzzer-get-state', code);

    // Initial state
    socket.on('buzzer-state', (state: any) => {
      if (state.gameState === 'lobby') {
        setGamePhase('lobby');
      } else if (state.gameState === 'finished') {
        setGamePhase('finished');
      }
      setCurrentQuestionIndex(state.currentQuestionIndex || 0);
      setBuzzes(state.buzzes || []);
      setCurrentAnswererIndex(state.currentAnswererIndex ?? -1);
      setEliminatedAnswers(state.eliminatedAnswers || []);
      setLeaderboard(state.leaderboard || []);
    });

    // Question shown
    socket.on('buzzer-question', (data: any) => {
      setGamePhase('question');
      setCurrentQuestionIndex(data.questionIndex);
      setTotalQuestions(data.totalQuestions);
      setCurrentQuestion(data.question);
      setBuzzTimeoutMs(data.buzzTimeoutMs);
      setBuzzStartTime(Date.now());
      setBuzzes([]);
      setCurrentAnswerer(null);
      setCurrentAnswererIndex(-1);
      setEliminatedAnswers([]);
      setLastResult(null);
      setLiveSelection([]);
    });

    // Buzz registered
    socket.on('buzz-registered', (data: any) => {
      setBuzzes(prev => {
        const existing = prev.find(b => b.nickname === data.nickname);
        if (existing) return prev;
        
        const newBuzz: BuzzEntry = {
          position: data.position,
          nickname: data.nickname,
          emoji: data.emoji,
          buzzTime: data.buzzTime,
          playerId: data.playerId,
        };
        
        return [...prev, newBuzz].sort((a, b) => a.position - b.position);
      });
    });

    // Enrollment phase started (10 second window for additional buzzers)
    socket.on('buzzer-enrolling', (data: any) => {
      setGamePhase('enrolling');
      setEnrollmentTimeoutMs(data.enrollmentTimeoutMs);
      setEnrollmentStartTime(data.enrollmentStartedAt || Date.now());
      setBuzzes(data.buzzOrder || []);
    });

    // Answering phase started
    socket.on('buzzer-answering', (data: any) => {
      setGamePhase('answering');
      setCurrentAnswerer(data.answerer);
      setCurrentAnswererIndex(0);
      setAnswerTimeoutMs(data.answerTimeoutMs);
      setAnswerStartTime(Date.now());
      setEliminatedAnswers(data.eliminatedAnswers || []);
      setBuzzes(data.buzzOrder || []);
      setLiveSelection([]);
    });

    // Live selection update (from answerer)
    socket.on('arena-live-selection', (data: { playerId: string; selectedAnswers: string[] }) => {
      if (currentAnswerer && data.playerId === currentAnswerer.playerId) {
        setLiveSelection(data.selectedAnswers);
      }
    });

    // Wrong answer, next buzzer
    socket.on('buzzer-wrong-next', (data: any) => {
      setCurrentAnswerer(data.nextAnswerer);
      setCurrentAnswererIndex(prev => prev + 1);
      setAnswerStartTime(Date.now());
      setEliminatedAnswers(data.eliminatedAnswers);
      setAnswerTimeoutMs(data.answerTimeoutMs);
      setLiveSelection([]);
    });

    // Result
    socket.on('buzzer-result', (data: any) => {
      setGamePhase('result');
      setLastResult(data);
      setLeaderboard(data.leaderboard || []);
    });

    // Transition to next question - stay in 'result' phase to show explanation
    socket.on('buzzer-transition', (data: any) => {
      // Don't change phase - keep showing result/explanation
      // Just update the transition timer
      setTransitionStartTime(data.transitionStartedAt || Date.now());
      setCurrentQuestionIndex(data.currentQuestionIndex);
      setLeaderboard(data.leaderboard || []);
    });

    // Game over
    socket.on('buzzer-game-over', (data: any) => {
      setGamePhase('finished');
      setLeaderboard(data.leaderboard || []);
    });

    // Player list update
    socket.on('buzzer-players-update', (data: { players: Array<{ playerId: string; nickname: string; emoji: string }> }) => {
      setPlayers(data.players);
    });

    // Session deleted by dozent
    socket.on('session-deleted', () => {
      setSessionDeleted(true);
    });

    return () => {
      socket.off('buzzer-state');
      socket.off('buzzer-question');
      socket.off('buzz-registered');
      socket.off('buzzer-enrolling');
      socket.off('buzzer-answering');
      socket.off('arena-live-selection');
      socket.off('buzzer-wrong-next');
      socket.off('buzzer-result');
      socket.off('buzzer-transition');
      socket.off('buzzer-game-over');
      socket.off('buzzer-players-update');
      socket.off('session-deleted');
    };
  }, [socket, code, currentAnswerer]);

  // Determine particle effect
  const getParticleEffect = () => {
    if (gamePhase === 'result' && lastResult?.correct) return 'fireworks';
    if (gamePhase === 'result' && !lastResult?.correct && !lastResult?.noBuzzes) return 'rain';
    return 'none';
  };

  // Session deleted screen
  if (sessionDeleted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🚫</div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Session beendet
          </h1>
          <p className="text-white/70 mb-6">
            Diese Session wurde vom Dozenten geschlossen.
          </p>
          <button
            onClick={() => navigate('/')}
            className="w-full bg-gradient-to-r from-cb-primary to-cb-accent hover:from-cb-accent hover:to-cb-primary text-white font-bold py-3 px-6 rounded-xl transition-all"
          >
            Zur Startseite
          </button>
        </div>
      </div>
    );
  }

  // Lobby screen
  if (gamePhase === 'lobby') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 text-white p-8 overflow-hidden">
        <div className="max-w-7xl mx-auto h-full flex flex-col">
          {/* Header */}
          <div className="text-center py-6">
            <h1 className="text-6xl font-black mb-2 bg-gradient-to-r from-cb-accent via-white to-cb-accent bg-clip-text text-transparent">
              CERTBUZZ
            </h1>
            <p className="text-xl text-cb-accent">
              Certification Quiz Challenge
            </p>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex gap-6">
            {/* QR Code Panel */}
            <div className="w-72 flex-shrink-0">
              <div className="bg-white/10 backdrop-blur rounded-3xl border border-white/20 p-6 text-center h-full flex flex-col justify-center">
                <div className="bg-white p-3 rounded-2xl inline-block mx-auto mb-4">
                  <QRCode url={sessionUrl} size={180} />
                </div>
                <p className="text-lg font-medium text-white mb-1">Jetzt mitmachen!</p>
                <p className="text-cb-accent text-sm">QR-Code scannen</p>
              </div>
            </div>

            {/* Players Grid */}
            <div className="flex-1 bg-white/5 backdrop-blur rounded-3xl border border-white/10 p-6">
              {players.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="text-7xl mb-4 animate-bounce">🎮</div>
                  <h2 className="text-2xl font-bold text-white/80 mb-2">Warte auf Spieler...</h2>
                  <p className="text-white/40">Spieler können jetzt beitreten</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                  {players.map((player, index) => (
                    <div 
                      key={player.playerId} 
                      className="text-center p-3 bg-white/10 rounded-2xl border border-white/10 transform hover:scale-105 transition-transform"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="text-4xl mb-1">{player.emoji}</div>
                      <div className="text-xs font-medium truncate text-white/90">{player.nickname}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="py-4 text-center">
            <div className="inline-flex items-center gap-4 px-8 py-3 bg-gradient-to-r from-cb-primary/40 to-cb-accent/40 rounded-full border border-cb-accent/30">
              <div className="flex gap-1">
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
              </div>
              <span className="text-xl font-bold">{players.length} Spieler bereit</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Finished screen
  if (gamePhase === 'finished') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 text-white p-8">
        <ParticleEffects type="fireworks" duration={30000} />
        
        <div className="max-w-4xl mx-auto relative z-10">
          <div className="text-center mb-12">
            <h1 className="text-7xl font-black mb-4 bg-gradient-to-r from-yellow-400 via-orange-400 to-yellow-400 bg-clip-text text-transparent">
              SPIEL BEENDET!
            </h1>
            <p className="text-xl text-cb-accent">Herzlichen Glückwunsch an alle Teilnehmer!</p>
          </div>

          {/* Podium */}
          {(() => {
            const finishedRanks = computeDenseRanks(leaderboard);
            return (
            <>
            <div className="flex justify-center items-end gap-4 mb-12">
              {/* 2nd Place */}
              {leaderboard[1] && (
                <div className="text-center">
                  <div className="text-6xl mb-2">{leaderboard[1].emoji}</div>
                  <div className="bg-gradient-to-b from-gray-300 to-gray-400 w-32 h-24 rounded-t-lg flex flex-col items-center justify-center border-t-4 border-gray-200">
                    <span className="text-4xl font-black text-gray-700">{finishedRanks[1]}</span>
                  </div>
                  <div className="bg-white/10 backdrop-blur p-3 rounded-b-lg border border-white/20">
                    <div className="font-bold text-white">{leaderboard[1].nickname}</div>
                    <div className="text-sm text-gray-300">{leaderboard[1].score} Punkte</div>
                  </div>
                </div>
              )}
              
              {/* 1st Place */}
              {leaderboard[0] && (
                <div className="text-center">
                  <div className="text-8xl mb-2">{leaderboard[0].emoji}</div>
                  <div className="bg-gradient-to-b from-yellow-400 to-yellow-500 w-40 h-32 rounded-t-lg flex flex-col items-center justify-center border-t-4 border-yellow-300">
                    <span className="text-5xl font-black text-yellow-900">{finishedRanks[0]}</span>
                  </div>
                  <div className="bg-yellow-500/30 backdrop-blur p-3 rounded-b-lg border border-yellow-400/50">
                    <div className="font-bold text-yellow-300 text-xl">{leaderboard[0].nickname}</div>
                    <div className="text-yellow-200">{leaderboard[0].score} Punkte</div>
                  </div>
                </div>
              )}
              
              {/* 3rd Place */}
              {leaderboard[2] && (
                <div className="text-center">
                  <div className="text-6xl mb-2">{leaderboard[2].emoji}</div>
                  <div className="bg-gradient-to-b from-orange-300 to-orange-400 w-32 h-20 rounded-t-lg flex flex-col items-center justify-center border-t-4 border-orange-200">
                    <span className="text-4xl font-black text-orange-800">{finishedRanks[2]}</span>
                  </div>
                  <div className="bg-white/10 backdrop-blur p-3 rounded-b-lg border border-white/20">
                    <div className="font-bold text-white">{leaderboard[2].nickname}</div>
                    <div className="text-sm text-gray-300">{leaderboard[2].score} Punkte</div>
                  </div>
                </div>
              )}
            </div>

            {/* Rest of leaderboard */}
            <div className="bg-white/10 backdrop-blur rounded-2xl p-6 border border-white/20">
              {leaderboard.slice(3, 10).map((player, index) => (
                <div key={player.nickname} className="flex items-center justify-between py-3 border-b border-white/10 last:border-0">
                  <div className="flex items-center gap-4">
                    <span className="w-8 text-2xl font-bold text-white/40">{finishedRanks[index + 3]}</span>
                    <span className="text-3xl">{player.emoji}</span>
                    <span className="text-xl font-medium">{player.nickname}</span>
                  </div>
                  <span className="text-xl font-bold text-cb-accent">{player.score}</span>
                </div>
              ))}
            </div>
            </>
            );
          })()}
        </div>
      </div>
    );
  }

  // Main game view
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 text-white p-4 overflow-hidden">
      <ParticleEffects type={getParticleEffect()} duration={5000} />
      
      <div className="max-w-7xl mx-auto h-screen flex flex-col relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between py-4 border-b border-white/20">
          <span className="text-2xl font-black bg-gradient-to-r from-cb-accent to-white bg-clip-text text-transparent">
            CERTBUZZ
          </span>
          <div className="text-xl font-medium">
            Frage {currentQuestionIndex + 1} / {totalQuestions}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 grid grid-cols-3 gap-6 py-6 min-h-0">
          {/* Left: Question + Options */}
          <div className="col-span-2 flex flex-col min-h-0">
            {/* Question Card */}
            {currentQuestion && (
              <div className="bg-white/10 backdrop-blur rounded-2xl p-6 flex-shrink-0">
                <div className="flex items-center gap-3 mb-4">
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                    currentQuestion.difficulty === 'easy' ? 'bg-green-500/30 text-green-300' :
                    currentQuestion.difficulty === 'medium' ? 'bg-yellow-500/30 text-yellow-300' :
                    'bg-red-500/30 text-red-300'
                  }`}>
                    {currentQuestion.difficulty === 'easy' ? '500 Punkte' :
                     currentQuestion.difficulty === 'medium' ? '1000 Punkte' :
                     '1500 Punkte'}
                  </span>
                  <span className="px-3 py-1 bg-cb-primary/30 rounded-full text-sm text-cb-accent">
                    {currentQuestion.category}
                  </span>
                </div>
                <h2 className="text-2xl font-bold leading-relaxed">
                  {currentQuestion.question}
                </h2>
              </div>
            )}

            {/* Options */}
            {currentQuestion && (gamePhase === 'answering' || gamePhase === 'result') && (
              <div className="mt-4 grid grid-cols-1 gap-3 flex-1 overflow-auto">
                {currentQuestion.options.map(option => {
                  const isEliminated = eliminatedAnswers.includes(option.id);
                  const isSelected = liveSelection.includes(option.id);
                  const isCorrect = lastResult?.correctAnswers?.includes(option.id);
                  
                  let bgColor = 'bg-white/5';
                  let borderColor = 'border-white/10';
                  
                  if (gamePhase === 'result' && isCorrect) {
                    bgColor = 'bg-green-500/30';
                    borderColor = 'border-green-400';
                  } else if (isEliminated) {
                    bgColor = 'bg-red-500/20';
                    borderColor = 'border-red-400/50';
                  } else if (isSelected) {
                    bgColor = 'bg-cb-primary/40';
                    borderColor = 'border-cb-accent';
                  }
                  
                  return (
                    <div
                      key={option.id}
                      className={`p-4 rounded-xl border-2 transition-all ${bgColor} ${borderColor} ${
                        isEliminated ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`w-8 h-8 flex items-center justify-center rounded-lg font-bold ${
                          isCorrect ? 'bg-green-500 text-white' :
                          isSelected ? 'bg-cb-primary text-white' :
                          isEliminated ? 'bg-red-500/50 text-white line-through' :
                          'bg-white/10'
                        }`}>
                          {option.id.toUpperCase()}
                        </span>
                        <span className={`flex-1 ${isEliminated ? 'line-through text-gray-500' : ''}`}>
                          {option.text}
                        </span>
                        {isSelected && !isEliminated && (
                          <span className="text-cb-accent animate-pulse">ausgewählt</span>
                        )}
                        {isCorrect && (
                          <span className="text-green-400 text-xl">&#10003;</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Correct Answer(s) - shown instead of full explanation */}
            {gamePhase === 'result' && lastResult?.correctAnswers && lastResult.correctAnswers.length > 0 && currentQuestion && (
              <div className="mt-4 bg-green-500/20 border border-green-400/50 rounded-xl p-4">
                <h3 className="font-bold text-green-300 mb-2">
                  Richtige Antwort{lastResult.correctAnswers.length > 1 ? 'en' : ''}:
                </h3>
                <ul className="space-y-2">
                  {lastResult.correctAnswers.map(answerId => {
                    const option = currentQuestion.options.find(opt => opt.id === answerId);
                    return option ? (
                      <li key={answerId} className="flex items-start gap-2 text-green-100">
                        <span className="text-green-400 font-bold">✓</span>
                        <span>{option.text}</span>
                      </li>
                    ) : null;
                  })}
                </ul>
              </div>
            )}

            {/* Buzzer Phase Message */}
            {gamePhase === 'question' && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-8xl mb-4 animate-bounce">&#128276;</div>
                  <div className="text-4xl font-bold">Drück den Buzzer!</div>
                  <div className="text-6xl font-mono font-bold text-cb-accent mt-4">
                    {Math.ceil(buzzTimeRemaining)}s
                  </div>
                </div>
              </div>
            )}

            {/* Enrollment Phase - just show countdown */}
            {gamePhase === 'enrolling' && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-8xl mb-4 animate-pulse">&#9203;</div>
                  <div className="text-6xl font-mono font-bold text-orange-400">
                    {Math.ceil(enrollmentTimeRemaining)}s
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Status Panel */}
          <div className="flex flex-col gap-4 min-h-0">
            {/* Current Answerer */}
            {gamePhase === 'answering' && currentAnswerer && (
              <div className="bg-cb-primary/30 border-2 border-cb-accent rounded-2xl p-6 animate-pulse-slow">
                <div className="text-center">
                  <div className="text-sm text-cb-accent mb-2">ANTWORTET GERADE</div>
                  <div className="text-6xl mb-2">{currentAnswerer.emoji}</div>
                  <div className="text-2xl font-bold">{currentAnswerer.nickname}</div>
                  <div className="text-4xl font-mono font-bold mt-4 text-cb-accent">
                    {Math.ceil(answerTimeRemaining)}s
                  </div>
                </div>
              </div>
            )}

            {/* Result Banner + Transition Timer */}
            {gamePhase === 'result' && lastResult && (
              <div className={`rounded-2xl p-6 ${
                lastResult.correct ? 'bg-green-500/30 border-2 border-green-400' :
                lastResult.noBuzzes ? 'bg-gray-500/30 border-2 border-gray-400' :
                'bg-red-500/30 border-2 border-red-400'
              }`}>
                <div className="text-center">
                  <div className="text-5xl mb-2">
                    {lastResult.correct ? '🎉' : lastResult.noBuzzes ? '⏱️' : '❌'}
                  </div>
                  {lastResult.correct && lastResult.answerer && (
                    <>
                      <div className="text-xl font-bold text-green-300">RICHTIG!</div>
                      <div className="text-3xl mt-2">{lastResult.answerer.emoji}</div>
                      <div className="font-medium">{lastResult.answerer.nickname}</div>
                      {lastResult.pointsAwarded && (
                        <div className="text-2xl font-bold text-green-400 mt-2">
                          +{lastResult.pointsAwarded}
                        </div>
                      )}
                    </>
                  )}
                  {!lastResult.correct && !lastResult.noBuzzes && (
                    <div className="text-xl font-bold text-red-300">FALSCH!</div>
                  )}
                  {lastResult.noBuzzes && (
                    <div className="text-xl font-bold text-gray-300">KEINE BUZZER</div>
                  )}
                  {/* Transition countdown */}
                  {transitionStartTime > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/20">
                      <div className="text-sm text-gray-400">Nächste Frage in</div>
                      <div className="text-3xl font-mono font-bold text-cb-accent">
                        {Math.ceil(transitionTimeRemaining)}s
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Buzz Order */}
            {(gamePhase === 'question' || gamePhase === 'enrolling' || gamePhase === 'answering') && (
              <div className="bg-white/5 rounded-2xl p-4 flex-shrink-0">
                <div className="text-sm text-gray-400 mb-3">BUZZ-REIHENFOLGE</div>
                {buzzes.length === 0 ? (
                  <div className="text-center text-gray-500 py-4">
                    Warte auf Spieler...
                  </div>
                ) : (
                  <div className="space-y-2">
                    {buzzes.slice(0, 6).map((buzz, index) => (
                      <div
                        key={buzz.nickname}
                        className={`flex items-center gap-3 p-2 rounded-lg ${
                          index === currentAnswererIndex 
                            ? 'bg-cb-primary/40 border border-cb-accent' 
                            : index < currentAnswererIndex
                              ? 'opacity-40 line-through'
                              : 'bg-white/5'
                        }`}
                      >
                        <span className="w-6 h-6 flex items-center justify-center bg-white/10 rounded-full text-sm font-bold">
                          {buzz.position}
                        </span>
                        <span className="text-xl">{buzz.emoji}</span>
                        <span className="flex-1 font-medium truncate">{buzz.nickname}</span>
                        <span className="text-xs text-gray-400">{(buzz.buzzTime / 1000).toFixed(2)}s</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Leaderboard */}
            <div className="bg-white/5 rounded-2xl p-4 flex-1 overflow-auto min-h-0">
              <div className="text-sm text-gray-400 mb-3">RANGLISTE</div>
              <div className="space-y-2">
                {(() => {
                  const sidebarRanks = computeDenseRanks(leaderboard);
                  return leaderboard.slice(0, 10).map((player, index) => {
                    const rank = sidebarRanks[index];
                    return (
                    <div
                      key={player.nickname}
                      className="flex items-center gap-3 p-2 rounded-lg bg-white/5"
                    >
                      <span className={`w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold ${getRankStyle(rank)}`}>
                        {rank}
                      </span>
                      <span className="text-lg">{player.emoji}</span>
                      <span className="flex-1 font-medium truncate">{player.nickname}</span>
                      <span className="font-bold text-cb-accent">{player.score}</span>
                    </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
