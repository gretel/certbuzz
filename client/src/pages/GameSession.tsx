import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSocket } from '../hooks/useSocket';
import { useSounds } from '../hooks/useSounds';
import { SingleChoice } from '../components/game/SingleChoice';
import { MultipleChoice } from '../components/game/MultipleChoice';
import { OrderQuestion } from '../components/game/OrderQuestion';
import { BuzzerGameSession } from './BuzzerGameSession';
import { TrainingGameSession } from './TrainingGameSession';
import { MarkdownText } from '../components/shared/MarkdownText';

interface Question {
  id: string;
  category: string;
  type: 'single' | 'multiple' | 'order';
  difficulty: string;
  question: string;
  options: Array<{ id: string; text: string }>;
  explanation: string;
  references?: string[];
}

interface ExamInfo {
  passPercent: number;
  totalQuestions: number;
  info: string;
}

interface SessionData {
  sessionCode: string;
  status: string;
  totalQuestions: number;
  questions: Question[];
  gameMode: 'racing' | 'buzzer' | 'training';
  gameState: string;
  questionBank?: string;
  examInfo?: ExamInfo;
}

export function GameSession() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const socket = getSocket();
  const { sounds } = useSounds();
  const soundsRef = useRef(sounds);
  useEffect(() => { soundsRef.current = sounds; }, [sounds]);
  const [sessionDeleted, setSessionDeleted] = useState(false);
  const [hasPlayedStart, setHasPlayedStart] = useState(false);

  // Try to restore nickname: 1. From this tab's session, 2. Last used globally
  const [nickname, setNickname] = useState(() => {
    const sessionNickname = sessionStorage.getItem(`session_${code}_nickname`);
    if (sessionNickname) return sessionNickname;
    const lastNickname = localStorage.getItem('lastNickname');
    return lastNickname || '';
  });
  // Use sessionStorage (per-tab) instead of localStorage (shared across tabs).
  // This prevents a second tab/window from hijacking another player's session.
  // Each tab gets its own join flow; refreshing the same tab preserves the session.
  const [playerId, setPlayerId] = useState<string | null>(() => {
    return sessionStorage.getItem(`session_${code}_playerId`) || null;
  });
  const [emoji, setEmoji] = useState(() => {
    return sessionStorage.getItem(`session_${code}_emoji`) || '';
  });
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([]);
  const [startTime, setStartTime] = useState<number>(0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [correctAnswers, setCorrectAnswers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [finalScore, setFinalScore] = useState(0);

  // Join session room early to receive session-deleted notifications (even before player joins)
  useEffect(() => {
    if (!socket || !code) return;

    // Join session room to receive notifications
    socket.emit('join-session', code);

    // Listen for session deletion
    socket.on('session-deleted', () => {
      setSessionDeleted(true);
    });

    return () => {
      socket.off('session-deleted');
    };
  }, [socket, code]);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch(`/api/session/${code}`);
        if (!response.ok) {
          throw new Error('Session nicht gefunden');
        }
        const data = await response.json();
        setSessionData(data);

        // Pre-populate order questions with default order if already joined
        if (playerId && data.questions.length > 0) {
          const currentQ = data.questions[currentQuestionIndex];
          if (currentQ?.type === 'order' && selectedAnswers.length === 0) {
            setSelectedAnswers(currentQ.options.map((o: { id: string }) => o.id));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden');
      } finally {
        setLoading(false);
      }
    };

    if (code) {
      fetchSession();
    }
  }, [code]);

  useEffect(() => {
    if (!socket || !playerId || !code) return;

    // Join the session room for leaderboard updates
    socket.emit('join-session', code);

    socket.on('answer-result', (data: { correct: boolean; correctAnswers: string[] }) => {
      setIsCorrect(data.correct);
      setCorrectAnswers(data.correctAnswers);
      setShowFeedback(true);

      // Play sound
      if (data.correct) {
        soundsRef.current.correct();
        setTotalCorrect(prev => prev + 1);
      } else {
        soundsRef.current.wrong();
      }
      setTotalTime(prev => prev + (Date.now() - startTime) / 1000);
    });

    return () => {
      socket.off('answer-result');
    };
  }, [socket, playerId, code]);

  // Fetch final stats when quiz is completed
  useEffect(() => {
    const fetchFinalStats = async () => {
      if (sessionData && currentQuestionIndex >= sessionData.totalQuestions && playerId) {
        try {
          const response = await fetch(`/api/player/${playerId}/stats`);
          if (response.ok) {
            const stats = await response.json();
            setTotalCorrect(stats.correctAnswers);
            setTotalTime(stats.totalTimeSeconds);
            setFinalScore(stats.score);
          }
        } catch (err) {
          console.error('Error fetching final stats:', err);
        }
      }
    };

    fetchFinalStats();
  }, [currentQuestionIndex, sessionData?.totalQuestions, playerId]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !nickname.trim()) return;

    try {
      const response = await fetch('/api/player/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: code, nickname: nickname.trim() }),
      });

      if (!response.ok) {
        throw new Error('Konnte nicht beitreten');
      }

      const data = await response.json();
      setPlayerId(data.playerId);
      setEmoji(data.emoji);
      setStartTime(Date.now());
      if (!hasPlayedStart) {
        soundsRef.current.gameStart();
        setHasPlayedStart(true);
      }

      // Store in localStorage to persist across page reloads
      sessionStorage.setItem(`session_${code}_playerId`, data.playerId);
      sessionStorage.setItem(`session_${code}_nickname`, nickname.trim());
      sessionStorage.setItem(`session_${code}_emoji`, data.emoji);
      // Also store globally for quick re-use in future sessions
      localStorage.setItem('lastNickname', nickname.trim());

      // Pre-populate order questions with default order
      if (sessionData && sessionData.questions.length > 0) {
        const firstQuestion = sessionData.questions[0];
        if (firstQuestion?.type === 'order') {
          setSelectedAnswers(firstQuestion.options.map(o => o.id));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Beitreten');
    }
  };

  const handleSubmitAnswer = () => {
    if (!socket || !playerId || !code || !sessionData) return;

    const timeSeconds = (Date.now() - startTime) / 1000;
    const currentQuestion = sessionData.questions[currentQuestionIndex];

    socket.emit('submit-answer', {
      sessionCode: code,
      playerId,
      questionId: currentQuestion.id,
      selectedAnswers,
      timeSeconds,
    });
  };

  const handleNextQuestion = () => {
    setShowFeedback(false);
    setCurrentQuestionIndex((prev) => {
      const nextIndex = prev + 1;
      // Pre-populate order questions with default order
      if (sessionData && nextIndex < sessionData.questions.length) {
        const nextQuestion = sessionData.questions[nextIndex];
        if (nextQuestion?.type === 'order') {
          setSelectedAnswers(nextQuestion.options.map(o => o.id));
        } else {
          setSelectedAnswers([]);
        }
      } else {
        setSelectedAnswers([]);
      }
      return nextIndex;
    });
    setStartTime(Date.now());
  };

  // Session deleted → auto-redirect
  useEffect(() => {
    if (sessionDeleted) navigate('/');
  }, [sessionDeleted, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center">
        <div className="text-2xl font-semibold text-white/70">{'Laden...'}</div>
      </div>
    );
  }

  if (error || !sessionData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center">
        <div className="text-2xl font-semibold text-red-400">{error || 'Fehler'}</div>
      </div>
    );
  }

  if (!playerId) {
    const isBuzzerMode = sessionData.gameMode === 'buzzer';
    const isTrainingMode = sessionData.gameMode === 'training';
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-black text-white mb-2">
              CERTBUZZ
            </h1>
            <p className="text-cb-accent">
              Certification Quiz Challenge
            </p>
          </div>

          {/* Card */}
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">
                {isBuzzerMode ? '🔔' : isTrainingMode ? '🧠' : '🏎️'}
              </div>
              <h2 className="text-2xl font-bold text-white">
                {isBuzzerMode ? 'Buzzer-Modus' : isTrainingMode ? 'Team Training' : 'Racing-Modus'}
              </h2>
            </div>

            <form onSubmit={handleJoin} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-cb-accent mb-2">
                  Wie heißt du?
                </label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Dein Name"
                  className="w-full px-5 py-4 bg-white/10 border-2 border-white/20 rounded-xl text-white placeholder-white/40 focus:border-cb-accent focus:outline-none text-lg"
                  required
                  maxLength={20}
                  autoFocus
                />
                {nickname && localStorage.getItem('lastNickname') === nickname && (
                  <p className="text-xs text-white/50 mt-2">
                    Zuletzt verwendeter Name
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-cb-primary to-cb-accent hover:from-cb-accent hover:to-cb-primary text-white font-bold py-4 px-6 rounded-xl transition-all transform hover:scale-[1.02] text-lg shadow-lg shadow-cb-primary/30"
              >
                Los geht's!
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Route to buzzer game session if in buzzer mode
  if (sessionData.gameMode === 'buzzer') {
    return (
      <BuzzerGameSession
        sessionCode={code!}
        totalQuestions={sessionData.totalQuestions}
        playerId={playerId}
        nickname={nickname}
        emoji={emoji}
      />
    );
  }

  if (sessionData.gameMode === 'training') {
    return (
      <TrainingGameSession
        sessionCode={code!}
        totalQuestions={sessionData.totalQuestions}
        playerId={playerId}
        nickname={nickname}
        emoji={emoji}
      />
    );
  }

  if (currentQuestionIndex >= sessionData.totalQuestions) {
    const totalQuestions = sessionData.totalQuestions;
    // Use server stats if available, otherwise use frontend tracking
    const correctCount = finalScore > 0 ? totalCorrect : 0;
    const timeCount = finalScore > 0 ? totalTime : 0;
    const wrongAnswers = totalQuestions - correctCount;
    const percentageCorrect = (correctCount / totalQuestions) * 100;
    const avgTimePerQuestion = timeCount / totalQuestions;

    const examInfo = sessionData.examInfo;
    const passPercent = examInfo?.passPercent ?? 70;
    const wouldPass = percentageCorrect >= passPercent;

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-8 max-w-2xl w-full">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-2">
              {'Quiz beendet!'} 🎉
            </h1>
            <p className="text-xl text-cb-accent">
              {nickname} {emoji}
            </p>
          </div>

          {/* Statistics */}
          <div className="space-y-6 mb-8">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-green-500/20 border-2 border-green-400/30 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-green-300">{correctCount}</div>
                <div className="text-sm text-white/70">Richtige Antworten</div>
              </div>
              <div className="bg-red-500/20 border-2 border-red-400/30 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-red-300">{wrongAnswers}</div>
                <div className="text-sm text-white/70">Falsche Antworten</div>
              </div>
            </div>

            <div className="bg-cb-primary/20 border-2 border-cb-accent/30 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-white/80">Genauigkeit</span>
                <span className="text-lg font-bold text-cb-accent">{percentageCorrect.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-white/20 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all ${
                    percentageCorrect >= passPercent ? 'bg-green-400' : 'bg-orange-400'
                  }`}
                  style={{ width: `${percentageCorrect}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="text-sm text-white/60 mb-1">Gesamtzeit</div>
                <div className="text-2xl font-bold text-white">
                  {Math.floor(timeCount / 60)}:{Math.floor(timeCount % 60).toString().padStart(2, '0')} min
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="text-sm text-white/60 mb-1">Ø pro Frage</div>
                <div className="text-2xl font-bold text-white">
                  {avgTimePerQuestion.toFixed(1)}s
                </div>
              </div>
            </div>

            <div className="bg-cb-primary/30 border border-cb-accent/40 text-white rounded-lg p-4 text-center">
              <div className="text-sm text-white/70 mb-1">Finaler Score</div>
              <div className="text-4xl font-bold text-cb-accent">{finalScore.toFixed(0)}</div>
            </div>
          </div>

          {/* Pass/Fail Prediction */}
          <div className={`p-6 rounded-lg border-2 mb-6 ${
            wouldPass
              ? 'bg-green-500/20 border-green-400/30'
              : 'bg-orange-500/20 border-orange-400/30'
          }`}>
            <div className="flex items-center justify-center gap-3 mb-2">
              <span className="text-3xl">{wouldPass ? '✅' : '⚠️'}</span>
              <h3 className={`text-xl font-bold ${
                wouldPass ? 'text-green-300' : 'text-orange-300'
              }`}>
                {wouldPass ? 'Prognose: Bestanden' : 'Prognose: Nicht bestanden'}
              </h3>
            </div>
            <p className={`text-center text-sm ${
              wouldPass ? 'text-green-200/80' : 'text-orange-200/80'
            }`}>
              {wouldPass
                ? `Mit ${percentageCorrect.toFixed(1)}% richtigen Antworten hättest du bestanden (≥${passPercent}% erforderlich).`
                : `Mit ${percentageCorrect.toFixed(1)}% richtigen Antworten hättest du nicht bestanden (≥${passPercent}% erforderlich). Weiter üben!`
              }
            </p>
          </div>

          {/* Exam Info */}
          {examInfo && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-6">
              <p className="text-sm text-white/60">{examInfo.info}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4">
            <a
              href="/leaderboard"
              className="flex-1 bg-gradient-to-r from-cb-primary to-cb-accent hover:from-cb-accent hover:to-cb-primary text-white font-bold py-3 px-6 rounded-xl transition-all text-center"
            >
              Rangliste 🏆
            </a>
            <button
              onClick={() => {
                // Clear only playerId to trigger rejoin with same nickname
                sessionStorage.removeItem(`session_${code}_playerId`);
                sessionStorage.removeItem(`session_${code}_emoji`);
                window.location.reload();
              }}
              className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-xl transition-all text-center"
            >
              Nochmal spielen 🔄
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentQuestion = sessionData.questions[currentQuestionIndex];

  // Safety check in case currentQuestion is undefined
  if (!currentQuestion) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center">
        <div className="text-2xl font-semibold text-white/70">Laden...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-lg rounded-t-2xl border border-white/20 border-b-0 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{emoji}</span>
              <span className="text-xl font-bold text-white">{nickname}</span>
            </div>
            <div className="text-sm font-medium text-white/60">
              {'Frage'} {currentQuestionIndex + 1} {'von'} {sessionData.totalQuestions}
            </div>
          </div>

          <div className="w-full bg-white/20 rounded-full h-2">
            <div
              className="bg-cb-accent h-2 rounded-full transition-all duration-300"
              style={{ width: `${((currentQuestionIndex + 1) / sessionData.totalQuestions) * 100}%` }}
            />
          </div>
        </div>

        {/* Question */}
        <div className="bg-white/10 backdrop-blur-lg border-x border-white/20 p-8 mb-0">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-block px-3 py-1 bg-cb-primary/30 text-cb-accent text-xs font-semibold rounded-full">
              {currentQuestion.category}
            </span>
            <span className="inline-block px-3 py-1 bg-white/10 text-white/60 text-xs font-mono rounded-full">
              {currentQuestion.id}
            </span>
          </div>

          <h2 className="text-2xl font-bold text-white mb-6">
            {currentQuestion.question}
          </h2>

          {currentQuestion.type === 'single' && (
            <SingleChoice
              options={currentQuestion.options}
              selected={selectedAnswers[0] || ''}
              onChange={(id) => setSelectedAnswers([id])}
              disabled={showFeedback}
            />
          )}

          {currentQuestion.type === 'multiple' && (
            <MultipleChoice
              options={currentQuestion.options}
              selected={selectedAnswers}
              onChange={setSelectedAnswers}
              disabled={showFeedback}
            />
          )}

          {currentQuestion.type === 'order' && (
            <OrderQuestion
              options={currentQuestion.options}
              order={selectedAnswers}
              onChange={setSelectedAnswers}
              disabled={showFeedback}
            />
          )}

          {showFeedback && (
            <div className={`mt-6 p-4 rounded-xl ${isCorrect ? 'bg-green-500/20 border-2 border-green-400/30' : 'bg-red-500/20 border-2 border-red-400/30'}`}>
              <p className={`font-bold mb-3 ${isCorrect ? 'text-green-300' : 'text-red-300'}`}>
                {isCorrect ? 'Richtig! ✅' : 'Falsch ❌'}
              </p>

              {/* All options with correct/wrong highlighting */}
              <ul className="space-y-2 mb-4">
                {currentQuestion.options.map(option => {
                  const isCorrectOption = correctAnswers.includes(option.id);
                  const wasSelected = selectedAnswers.includes(option.id);
                  return (
                    <li
                      key={option.id}
                      className={`flex items-start gap-2 px-3 py-2 rounded-lg ${
                        isCorrectOption
                          ? 'bg-green-500/20 border border-green-400/30'
                          : wasSelected
                            ? 'bg-red-500/10 border border-red-400/20'
                            : 'bg-white/5 border border-white/5'
                      }`}
                    >
                      <span className={`font-bold mt-0.5 ${
                        isCorrectOption ? 'text-green-400' : wasSelected ? 'text-red-400' : 'text-white/30'
                      }`}>
                        {isCorrectOption ? '✓' : wasSelected ? '✗' : option.id.toUpperCase()}
                      </span>
                      <span className={
                        isCorrectOption ? 'text-green-100 font-medium' : wasSelected ? 'text-red-200' : 'text-white/60'
                      }>
                        {option.text}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="text-sm text-white/80">
                <MarkdownText className="mt-1">{currentQuestion.explanation}</MarkdownText>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="bg-white/10 backdrop-blur-lg rounded-b-2xl border border-white/20 border-t-0 p-6">
          {!showFeedback ? (
            <button
              onClick={handleSubmitAnswer}
              disabled={selectedAnswers.length === 0}
              className="w-full bg-gradient-to-r from-cb-primary to-cb-accent hover:from-cb-accent hover:to-cb-primary text-white font-bold py-4 px-8 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {'Antwort absenden'}
            </button>
          ) : (
            <button
              onClick={handleNextQuestion}
              className="w-full bg-gradient-to-r from-cb-primary to-cb-accent hover:from-cb-accent hover:to-cb-primary text-white font-bold py-4 px-8 rounded-xl transition-all"
            >
              {currentQuestionIndex < sessionData.totalQuestions - 1 ? 'Nächste Frage' : 'Fertig'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
