import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../hooks/useSocket';
import { useSounds } from '../hooks/useSounds';
import { SingleChoice } from '../components/game/SingleChoice';
import { MultipleChoice } from '../components/game/MultipleChoice';
import { OrderQuestion } from '../components/game/OrderQuestion';
import { BuzzerButton } from '../components/buzzer/BuzzerButton';
import { BuzzOrderDisplay } from '../components/buzzer/BuzzOrderDisplay';
import { CountdownTimer } from '../components/buzzer/CountdownTimer';
import { WatchingOverlay } from '../components/buzzer/WatchingOverlay';
import { TransitionScreen } from '../components/buzzer/TransitionScreen';
import { MarkdownText } from '../components/shared/MarkdownText';

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
}

interface LeaderboardEntry {
  nickname: string;
  emoji: string;
  score: number;
  correct_answers: number;
}

interface Answerer {
  playerId: string;
  nickname: string;
  emoji: string;
  buzzTime?: number;
}

type GamePhase = 'lobby' | 'question' | 'enrolling' | 'answering' | 'result' | 'transition' | 'finished';

interface BuzzerGameSessionProps {
  sessionCode: string;
  totalQuestions: number;
  playerId: string;
  nickname: string;
  emoji: string;
}

export function BuzzerGameSession({
  sessionCode,
  totalQuestions,
  playerId,
  nickname,
  emoji
}: BuzzerGameSessionProps) {
  const navigate = useNavigate();
  const socket = getSocket();
  const { sounds } = useSounds();
  const hasJoinedRef = useRef(false);
  const soundsRef = useRef(sounds);
  const [sessionDeleted, setSessionDeleted] = useState(false);
  
  // Keep soundsRef updated
  useEffect(() => {
    soundsRef.current = sounds;
  }, [sounds]);

  // Game state
  const [gamePhase, setGamePhase] = useState<GamePhase>('lobby');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [buzzes, setBuzzes] = useState<BuzzEntry[]>([]);
  const [currentAnswerer, setCurrentAnswerer] = useState<Answerer | null>(null);
  const [currentAnswererIndex, setCurrentAnswererIndex] = useState(-1);
  const [eliminatedAnswers, setEliminatedAnswers] = useState<string[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  
  // Player state
  const [hasBuzzed, setHasBuzzed] = useState(false);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([]);
  
  // Timing
  const [buzzStartTime, setBuzzStartTime] = useState(0);
  const [enrollmentStartTime, setEnrollmentStartTime] = useState(0);
  const [answerStartTime, setAnswerStartTime] = useState(0);
  const [buzzTimeoutMs, setBuzzTimeoutMs] = useState(10000);
  const [enrollmentTimeoutMs, setEnrollmentTimeoutMs] = useState(10000);
  const [answerTimeoutMs, setAnswerTimeoutMs] = useState(15000);
  const [transitionStartTime, setTransitionStartTime] = useState(0);
  const [transitionTimeoutMs, setTransitionTimeoutMs] = useState(20000);
  const [buzzTimeRemaining, setBuzzTimeRemaining] = useState(10);
  const [enrollmentTimeRemaining, setEnrollmentTimeRemaining] = useState(10);
  const [answerTimeRemaining, setAnswerTimeRemaining] = useState(15);
  const [transitionTimeRemaining, setTransitionTimeRemaining] = useState(20);

  // Result state
  const [lastResult, setLastResult] = useState<{
    correct: boolean;
    answerer?: Answerer;
    correctAnswers?: string[];
    explanation?: string;
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
        const remaining = Math.max(0, (transitionTimeoutMs - (now - transitionStartTime)) / 1000);
        setTransitionTimeRemaining(remaining);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [gamePhase, buzzStartTime, enrollmentStartTime, answerStartTime, transitionStartTime, buzzTimeoutMs, enrollmentTimeoutMs, answerTimeoutMs, transitionTimeoutMs]);

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;

    // Join buzzer session (only once)
    if (!hasJoinedRef.current) {
      socket.emit('buzzer-join-session', { sessionCode, playerId });
      hasJoinedRef.current = true;
    }

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
      // Play game start sound on first question
      if (data.questionIndex === 0) {
        soundsRef.current.gameStart();
      }
      
      setGamePhase('question');
      setCurrentQuestionIndex(data.questionIndex);
      setCurrentQuestion(data.question);
      setBuzzTimeoutMs(data.buzzTimeoutMs);
      setBuzzStartTime(Date.now());
      setBuzzes([]);
      setHasBuzzed(false);
      setIsMyTurn(false);
      setCurrentAnswerer(null);
      setCurrentAnswererIndex(-1);
      setEliminatedAnswers([]);
      setSelectedAnswers([]);
      setLastResult(null);
      
      // Pre-populate order questions
      if (data.question.type === 'order') {
        setSelectedAnswers(data.question.options.map((o: any) => o.id));
      }
    });

    // Buzz registered
    socket.on('buzz-registered', (data: any) => {
      // Play buzz sound
      soundsRef.current.buzz();
      
      setBuzzes(prev => {
        // Update or add the buzz entry
        const existing = prev.find(b => b.nickname === data.nickname);
        if (existing) return prev;
        
        const newBuzz: BuzzEntry = {
          position: data.position,
          nickname: data.nickname,
          emoji: data.emoji,
          buzzTime: data.buzzTime,
        };
        
        return [...prev, newBuzz].sort((a, b) => a.position - b.position);
      });

      // Check if this was my buzz
      if (data.playerId === playerId) {
        setHasBuzzed(true);
      }
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
      
      // Am I the answerer?
      setIsMyTurn(data.answerer.playerId === playerId);
    });

    // Wrong answer, next buzzer
    socket.on('buzzer-wrong-next', (data: any) => {
      // Play wrong sound
      soundsRef.current.wrong();
      
      setCurrentAnswerer(data.nextAnswerer);
      setCurrentAnswererIndex(prev => prev + 1);
      setAnswerStartTime(Date.now());
      setEliminatedAnswers(data.eliminatedAnswers);
      setAnswerTimeoutMs(data.answerTimeoutMs);
      
      // Am I the next answerer?
      setIsMyTurn(data.nextAnswerer.playerId === playerId);
    });

    // Result
    socket.on('buzzer-result', (data: any) => {
      // Play correct or wrong sound
      if (data.correct) {
        soundsRef.current.correct();
      } else {
        soundsRef.current.wrong();
      }
      
      setGamePhase('result');
      setLastResult(data);
      setLeaderboard(data.leaderboard || []);
      setIsMyTurn(false);
    });

    // Transition to next question
    socket.on('buzzer-transition', (data: any) => {
      setGamePhase('transition');
      // Use server timestamp for better sync, with fallback to local time
      setTransitionStartTime(data.transitionStartedAt || Date.now());
      setTransitionTimeoutMs(data.nextQuestionIn || 20000);
      setCurrentQuestionIndex(data.currentQuestionIndex);
      setLeaderboard(data.leaderboard || []);
    });

    // Game over
    socket.on('buzzer-game-over', (data: any) => {
      setGamePhase('finished');
      setLeaderboard(data.leaderboard || []);
    });

    // Player list update
    socket.on('buzzer-players-update', () => {
      // Could use this to show lobby player list
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
      socket.off('buzzer-wrong-next');
      socket.off('buzzer-result');
      socket.off('buzzer-transition');
      socket.off('buzzer-game-over');
      socket.off('buzzer-players-update');
      socket.off('session-deleted');
    };
  }, [socket, sessionCode, playerId]);

  const handleBuzz = useCallback(() => {
    if (!socket || hasBuzzed) return;
    
    socket.emit('buzzer-press', {
      sessionCode,
      playerId,
      clientTimestamp: Date.now(),
    });
  }, [socket, sessionCode, playerId, hasBuzzed]);

  const handleSubmitAnswer = useCallback(() => {
    if (!socket || !isMyTurn) return;
    
    socket.emit('buzzer-submit-answer', {
      sessionCode,
      playerId,
      selectedAnswers,
    });
  }, [socket, sessionCode, playerId, selectedAnswers, isMyTurn]);

  // Broadcast live selection to Arena (for Dozent assistance)
  useEffect(() => {
    if (!socket || !isMyTurn || gamePhase !== 'answering') return;
    
    socket.emit('buzzer-live-selection', {
      sessionCode,
      playerId,
      selectedAnswers,
    });
  }, [socket, sessionCode, playerId, selectedAnswers, isMyTurn, gamePhase]);

  // Session deleted screen
  if (sessionDeleted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-azure-dark to-gray-900 flex items-center justify-center p-4">
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
            className="w-full bg-gradient-to-r from-azure-blue to-azure-light hover:from-azure-light hover:to-azure-blue text-white font-bold py-3 px-6 rounded-xl transition-all"
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
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-azure-dark to-gray-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-black text-white mb-2">
              AZURELYMPICS
            </h1>
            <p className="text-azure-light">
              Buzzer-Modus
            </p>
          </div>

          {/* Player Card */}
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20 mb-6">
            <div className="text-8xl mb-4">{emoji}</div>
            <h2 className="text-3xl font-bold text-white mb-2">{nickname}</h2>
            <p className="text-azure-light">Du bist dabei!</p>
          </div>

          {/* Waiting indicator */}
          <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className="w-3 h-3 bg-azure-light rounded-full animate-pulse" />
              <div className="w-3 h-3 bg-azure-light rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
              <div className="w-3 h-3 bg-azure-light rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
            </div>
            <p className="text-white text-lg">Warte auf Spielstart</p>
            <p className="text-white/50 text-sm mt-1">Der Dozent startet gleich...</p>
          </div>
        </div>
      </div>
    );
  }

  // Transition screen
  if (gamePhase === 'transition') {
    return (
      <TransitionScreen
        currentQuestionIndex={currentQuestionIndex}
        totalQuestions={totalQuestions}
        timeRemaining={transitionTimeRemaining}
        leaderboard={leaderboard}
        lastResult={lastResult}
        questionOptions={currentQuestion?.options || []}
      />
    );
  }

  // Finished screen
  if (gamePhase === 'finished') {
    const myRank = leaderboard.findIndex(p => p.nickname === nickname) + 1;
    const myScore = leaderboard.find(p => p.nickname === nickname)?.score || 0;

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-azure-dark to-gray-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-8 max-w-2xl w-full">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-2">
              Spiel beendet! 🎉
            </h1>
            <p className="text-xl text-azure-light">
              {nickname} {emoji}
            </p>
          </div>

          <div className="bg-azure-blue/20 rounded-2xl p-6 mb-6 text-center border border-azure-light/30">
            <p className="text-sm text-white/60 mb-2">Dein Ergebnis</p>
            <div className="text-4xl font-bold text-azure-light mb-2">Platz {myRank}</div>
            <div className="text-2xl font-bold text-white">{myScore} Punkte</div>
          </div>

          {/* Final Leaderboard */}
          <div className="bg-white/5 rounded-2xl p-4 mb-6 border border-white/10">
            <h3 className="font-semibold text-white/80 mb-3 text-center">
              Endstand
            </h3>
            <ul className="space-y-2">
              {leaderboard.slice(0, 10).map((player, index) => (
                <li 
                  key={player.nickname}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                    player.nickname === nickname ? 'bg-azure-blue/30 border border-azure-light/50' : 'bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      index === 0 ? 'bg-yellow-400 text-yellow-900' :
                      index === 1 ? 'bg-gray-300 text-gray-700' :
                      index === 2 ? 'bg-orange-300 text-orange-900' :
                      'bg-white/10 text-white/60'
                    }`}>
                      {index + 1}
                    </span>
                    <span className="text-xl">{player.emoji}</span>
                    <span className="font-medium text-white">{player.nickname}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-azure-light">{player.score}</span>
                    <span className="text-sm text-white/50 ml-2">({player.correct_answers} richtig)</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <a
            href="/"
            className="w-full block bg-gradient-to-r from-azure-blue to-azure-light hover:from-azure-light hover:to-azure-blue text-white font-bold py-3 px-6 rounded-xl transition-all text-center"
          >
            Zur Startseite
          </a>
        </div>
      </div>
    );
  }

  // Question/Answering/Result phases
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-azure-dark to-gray-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-lg rounded-t-2xl border border-white/20 border-b-0 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{emoji}</span>
              <span className="text-xl font-bold text-white">{nickname}</span>
            </div>
            <div className="text-sm font-medium text-white/60">
              Frage {currentQuestionIndex + 1} von {totalQuestions}
            </div>
          </div>

          <div className="w-full bg-white/20 rounded-full h-2">
            <div
              className="bg-azure-light h-2 rounded-full transition-all duration-300"
              style={{ width: `${((currentQuestionIndex + 1) / totalQuestions) * 100}%` }}
            />
          </div>
        </div>

        {/* Timer (on top) */}
        {gamePhase === 'question' && (
          <div className="bg-white/5 backdrop-blur border-x border-white/20 p-4">
            <CountdownTimer
              durationMs={buzzTimeoutMs}
              startTime={buzzStartTime}
              label="Zeit zum Buzzen"
              warningThreshold={3}
            />
          </div>
        )}

        {gamePhase === 'enrolling' && (
          <div className="bg-white/5 backdrop-blur border-x border-white/20 p-4">
            <CountdownTimer
              durationMs={enrollmentTimeoutMs}
              startTime={enrollmentStartTime}
              label={hasBuzzed ? "Warte auf weitere Buzzer..." : "Noch Zeit zum Buzzen!"}
              warningThreshold={3}
            />
          </div>
        )}

        {gamePhase === 'answering' && isMyTurn && (
          <div className="bg-white/5 backdrop-blur border-x border-white/20 p-4">
            <CountdownTimer
              durationMs={answerTimeoutMs}
              startTime={answerStartTime}
              label="Zeit zum Antworten"
              warningThreshold={5}
            />
          </div>
        )}

        {/* Question Card */}
        {currentQuestion && (
          <div className="bg-white/10 backdrop-blur-lg border-x border-white/20 p-8 relative">
            {/* Watching overlay for non-answerers */}
            {gamePhase === 'answering' && !isMyTurn && currentAnswerer && (
              <WatchingOverlay 
                answerer={currentAnswerer}
                timeRemaining={answerTimeRemaining}
              />
            )}

            <div className="mb-2 flex items-center gap-2 flex-wrap">
              <span className="inline-block px-3 py-1 bg-azure-blue/30 text-azure-light text-xs font-semibold rounded-full">
                {currentQuestion.category}
              </span>
              <span className={`inline-block px-3 py-1 text-xs font-semibold rounded-full ${
                currentQuestion.difficulty === 'easy' ? 'bg-green-500/20 text-green-300' :
                currentQuestion.difficulty === 'medium' ? 'bg-yellow-500/20 text-yellow-300' :
                'bg-red-500/20 text-red-300'
              }`}>
                {currentQuestion.difficulty === 'easy' ? '500 Punkte' :
                 currentQuestion.difficulty === 'medium' ? '1000 Punkte' :
                 '1500 Punkte'}
              </span>
            </div>

            <h2 className="text-2xl font-bold text-white mb-6">
              {currentQuestion.question}
            </h2>

            {/* Show options only in answering phase for the answerer, or in result phase */}
            {(gamePhase === 'answering' && isMyTurn) || gamePhase === 'result' ? (
              <>
                {currentQuestion.type === 'single' && (
                  <SingleChoice
                    options={currentQuestion.options}
                    selected={selectedAnswers[0] || ''}
                    onChange={(id) => setSelectedAnswers([id])}
                    disabled={gamePhase === 'result'}
                    eliminatedAnswers={eliminatedAnswers}
                  />
                )}

                {currentQuestion.type === 'multiple' && (
                  <MultipleChoice
                    options={currentQuestion.options}
                    selected={selectedAnswers}
                    onChange={setSelectedAnswers}
                    disabled={gamePhase === 'result'}
                    eliminatedAnswers={eliminatedAnswers}
                  />
                )}

                {currentQuestion.type === 'order' && (
                  <OrderQuestion
                    options={currentQuestion.options}
                    order={selectedAnswers}
                    onChange={setSelectedAnswers}
                    disabled={gamePhase === 'result'}
                  />
                )}

                {/* Submit button (directly below answers) */}
                {gamePhase === 'answering' && isMyTurn && (
                  <button
                    onClick={handleSubmitAnswer}
                    disabled={selectedAnswers.length === 0}
                    className="w-full mt-6 bg-gradient-to-r from-azure-blue to-azure-light hover:from-azure-light hover:to-azure-blue text-white font-bold py-4 px-8 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Antwort absenden
                  </button>
                )}
              </>
            ) : (gamePhase === 'question' || gamePhase === 'enrolling') ? (
              /* Buzzer phase - show buzzer button */
              <div className="flex flex-col items-center py-8">
                <BuzzerButton
                  onBuzz={handleBuzz}
                  disabled={hasBuzzed}
                  hasBuzzed={hasBuzzed}
                  timeRemaining={gamePhase === 'enrolling' ? enrollmentTimeRemaining : buzzTimeRemaining}
                />
                {gamePhase === 'enrolling' && !hasBuzzed && (
                  <p className="text-orange-600 font-medium mt-4 animate-pulse">
                    Schnell - Loss geht's!
                  </p>
                )}
              </div>
            ) : null}

            {/* Result feedback */}
            {gamePhase === 'result' && lastResult && (
              <div className={`mt-6 p-4 rounded-xl ${
                lastResult.correct ? 'bg-green-500/20 border-2 border-green-400/30' : 
                lastResult.noBuzzes ? 'bg-white/5 border-2 border-white/20' :
                'bg-red-500/20 border-2 border-red-400/30'
              }`}>
                {lastResult.noBuzzes ? (
                  <p className="font-bold text-white/80 mb-2">
                    Niemand hat gebuzzert! ⏱️
                  </p>
                ) : lastResult.correct ? (
                  <>
                    <p className="font-bold text-green-300 mb-2">
                      {lastResult.answerer?.emoji} {lastResult.answerer?.nickname} hat richtig geantwortet! ✅
                    </p>
                    {lastResult.pointsAwarded && (
                      <p className="text-green-400">
                        +{lastResult.pointsAwarded} Punkte 
                        ({lastResult.basePoints} + {lastResult.speedBonus} Speed-Bonus)
                      </p>
                    )}
                  </>
                ) : (
                  <p className="font-bold text-red-300 mb-2">
                    {lastResult.noMoreBuzzers 
                      ? 'Alle Buzzer haben falsch geantwortet! ❌'
                      : `${lastResult.answerer?.emoji} ${lastResult.answerer?.nickname} hat falsch geantwortet ❌`
                    }
                  </p>
                )}
                
                {lastResult.explanation && (
                  <div className="text-sm text-white/70 mt-2">
                    <strong className="text-white">Erklärung:</strong>
                    <MarkdownText className="mt-1">{lastResult.explanation}</MarkdownText>
                  </div>
                )}
                
                {lastResult.correctAnswers && (
                  <div className="text-sm text-white/60 mt-2">
                    <strong className="text-white/80">Richtige Antwort(en):</strong>
                    <ul className="list-disc ml-5 mt-1">
                      {lastResult.correctAnswers.map(answerId => {
                        const option = currentQuestion.options.find(opt => opt.id === answerId);
                        return option ? (
                          <li key={answerId}>{option.text}</li>
                        ) : null;
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Buzz Order Display (on bottom) */}
        {(gamePhase === 'question' || gamePhase === 'enrolling' || gamePhase === 'answering') && (
          <div className="bg-white/10 backdrop-blur-lg rounded-b-2xl border border-white/20 border-t-0 p-4">
            <BuzzOrderDisplay
              buzzes={buzzes}
              currentAnswererIndex={currentAnswererIndex}
              myPlayerId={playerId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
