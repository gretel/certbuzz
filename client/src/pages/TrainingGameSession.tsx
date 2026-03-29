import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../hooks/useSocket';
import { useSounds } from '../hooks/useSounds';
import { ConfidenceGrid } from '../components/game/ConfidenceGrid';
import type { Vote } from '../components/game/ConfidenceGrid';
import { TrainingReveal } from '../components/game/TrainingReveal';
import { TransitionScreen } from '../components/buzzer/TransitionScreen';
import { MarkdownText } from '../components/shared/MarkdownText';

type TrainingPhase = 'lobby' | 'question' | 'reveal' | 'result' | 'transition' | 'finished';

interface TrainingGameSessionProps {
  sessionCode: string;
  totalQuestions: number;
  playerId: string;
  nickname: string;
  emoji: string;
}

interface TrainingQuestion {
  id: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  hint?: string;
  options: Array<{ id: string; text: string }>;
  explanation?: string;
  references?: string[];
}

interface PlayerResult {
  playerId: string;
  nickname: string;
  emoji: string;
  answerId: string;
  confidenceZone: 1 | 2 | 3;
  clickX: number;
  clickY: number;
  correct: boolean;
  pointsAwarded: number;
}

interface TrainingResult {
  correctAnswerId: string;
  question: TrainingQuestion;
  votes: PlayerResult[];
  leaderboard: Array<{ nickname: string; emoji: string; score: number; correct_answers: number }>;
}

interface TransitionData {
  currentQuestionIndex: number;
  nextQuestionIndex: number;
  nextQuestionIn: number;
  transitionStartedAt: number;
  isGameOver: boolean;
  leaderboard: Array<{ nickname: string; emoji: string; score: number; correct_answers: number }>;
}

export function TrainingGameSession({
  sessionCode,
  totalQuestions,
  playerId,
  nickname,
  emoji,
}: TrainingGameSessionProps) {
  const navigate = useNavigate();
  const socket = getSocket();
  const { sounds } = useSounds();
  const soundsRef = useRef(sounds);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep soundsRef updated
  useEffect(() => {
    soundsRef.current = sounds;
  }, [sounds]);

  const [sessionDeleted, setSessionDeleted] = useState(false);
  const [phase, setPhase] = useState<TrainingPhase>('lobby');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<TrainingQuestion | null>(null);
  const [ownVote, setOwnVote] = useState<Vote | null>(null);
  const [otherVotes, setOtherVotes] = useState<Vote[]>([]);
  const [result, setResult] = useState<TrainingResult | null>(null);
  const [transitionData, setTransitionData] = useState<TransitionData | null>(null);
  const [leaderboard, setLeaderboard] = useState<Array<{ nickname: string; emoji: string; score: number; correct_answers: number }>>([]);
  const [timeLeft, setTimeLeft] = useState(180);

  const gridContainerRef = useRef<HTMLDivElement>(null);
  // Ref to track current phase inside socket callbacks (avoid stale closure)
  const phaseRef = useRef<TrainingPhase>('lobby');
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Live countdown for transition screen
  const [transitionTimeLeft, setTransitionTimeLeft] = useState(20);

  // Countdown timer: start when phase becomes 'question'
  useEffect(() => {
    if (phase !== 'question') {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      return;
    }

    setTimeLeft(180);
    timerIntervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [phase]);

  // Auto-advance from 'result' → 'transition' once transitionData is available.
  // This fires when: reveal completes (setPhase('result')) AND transitionData is already set
  // (training-transition arrived during reveal phase).
  useEffect(() => {
    if (phase !== 'result' || !transitionData) return;
    const elapsed = Date.now() - transitionData.transitionStartedAt;
    const remaining = Math.max(500, transitionData.nextQuestionIn - elapsed);
    const timer = setTimeout(() => setPhase('transition'), remaining);
    return () => clearTimeout(timer);
  }, [phase, transitionData]);

  // Live countdown for TransitionScreen
  useEffect(() => {
    if (phase !== 'transition' || !transitionData) return;
    const tick = () => {
      const elapsed = Date.now() - transitionData.transitionStartedAt;
      const rem = Math.max(0, (transitionData.nextQuestionIn - elapsed) / 1000);
      setTransitionTimeLeft(rem);
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [phase, transitionData]);

  // Socket events
  useEffect(() => {
    if (!socket) return;

    // Join (or re-join) the session room. Must happen on every connect/reconnect
    // because Socket.IO drops room membership when the underlying connection resets.
    const joinRoom = () => {
      socket.emit('training-join-session', { sessionCode, playerId });
    };

    if (socket.connected) {
      joinRoom();
    }
    // Re-join on every reconnect (new server-side socket = no room membership)
    socket.on('connect', joinRoom);

    socket.on('session-deleted', () => {
      setSessionDeleted(true);
    });

    socket.on('training-state', (state: any) => {
      // Map server phase to client phase. 'result' without result payload → show
      // disabled grid. 'transition' → restore transition countdown.
      if (state.phase) {
        const serverToClient: Record<string, TrainingPhase> = {
          lobby: 'lobby',
          question: 'question',
          result: 'question',      // no result payload on reconnect → disabled grid
          transition: 'transition', // server sends this when transition data is active
          finished: 'finished',
        };
        const mapped = serverToClient[state.phase];
        if (mapped) setPhase(mapped);
      }
      if (state.currentQuestionIndex !== undefined) setCurrentQuestionIndex(state.currentQuestionIndex);
      if (state.question) setCurrentQuestion(state.question);
      if (state.leaderboard) setLeaderboard(state.leaderboard);
      // Restore transition data for countdown display on reconnect
      if (state.transition) {
        setTransitionData({
          currentQuestionIndex: state.currentQuestionIndex ?? 0,
          ...state.transition,
          leaderboard: state.leaderboard ?? [],
        });
      }
      if (state.votes && Array.isArray(state.votes)) {
        const own = state.votes.find((v: any) => v.playerId === playerId);
        if (own) {
          setOwnVote({
            playerId: own.playerId,
            emoji: own.emoji ?? emoji,
            answerId: own.answerId,
            confidenceZone: own.confidenceZone,
            clickX: own.clickX,
            clickY: own.clickY,
          });
        }
        setOtherVotes(
          state.votes
            .filter((v: any) => v.playerId !== playerId)
            .map((v: any) => ({
              playerId: v.playerId,
              emoji: v.emoji ?? '',
              answerId: v.answerId,
              confidenceZone: v.confidenceZone,
              clickX: v.clickX,
              clickY: v.clickY,
            }))
        );
      }
    });

    socket.on('training-question', (data: any) => {
      if (data.questionIndex === 0) {
        soundsRef.current.gameStart();
      }
      setCurrentQuestion(data.question);
      setCurrentQuestionIndex(data.questionIndex ?? 0);
      setOwnVote(null);
      setOtherVotes([]);
      setResult(null);
      // Clear stale transitionData so the auto-advance effect doesn't fire
      // immediately when this round's result phase starts (old startedAt would
      // give a near-zero remaining time).
      setTransitionData(null);
      setPhase('question');
    });

    socket.on('training-vote-update', (data: any) => {
      if (data.playerId === playerId) return;
      const vote: Vote = {
        playerId: data.playerId,
        nickname: data.nickname ?? '',
        emoji: data.emoji ?? '',
        answerId: data.answerId,
        confidenceZone: data.confidenceZone,
        clickX: data.clickX,
        clickY: data.clickY,
      };
      setOtherVotes(prev => {
        const without = prev.filter(v => v.playerId !== data.playerId);
        return [...without, vote];
      });
    });

    socket.on('training-result', (data: TrainingResult) => {
      setResult(data);
      setPhase('reveal');
      // Play sound based on own result
      const ownEntry = data.votes.find((v: any) => v.playerId === playerId);
      if (ownEntry) {
        if (ownEntry.correct) soundsRef.current.correct();
        else soundsRef.current.wrong();
      }
    });

    socket.on('training-transition', (data: TransitionData) => {
      setTransitionData(data);
      setLeaderboard(data.leaderboard ?? []);
      // Only advance immediately if we're already past the reveal animation.
      // If we're in 'reveal', the auto-advance effect will handle it once
      // handleRevealComplete fires.
      if (phaseRef.current === 'result') {
        setPhase('transition');
      }
    });

    socket.on('training-game-over', (data: any) => {
      setLeaderboard(data.leaderboard ?? []);
      setPhase('finished');
    });

    return () => {
      socket.off('connect', joinRoom);
      socket.off('session-deleted');
      socket.off('training-state');
      socket.off('training-question');
      socket.off('training-vote-update');
      socket.off('training-result');
      socket.off('training-transition');
      socket.off('training-game-over');
    };
  }, [socket, sessionCode, playerId, emoji]);

  const handleVote = useCallback(
    (answerId: string, confidenceZone: 1 | 2 | 3, clickX: number, clickY: number) => {
      if (!socket) return;
      soundsRef.current.tick();
      const vote: Vote = { playerId, emoji, answerId, confidenceZone, clickX, clickY };
      setOwnVote(vote);
      socket.emit('training-vote', { sessionCode, playerId, answerId, confidenceZone, clickX, clickY });
    },
    [socket, sessionCode, playerId, emoji]
  );

  const handleRevealComplete = useCallback(() => {
    setPhase('result');
  }, []);

  // --- Session deleted → auto-redirect ---
  useEffect(() => {
    if (sessionDeleted) navigate('/');
  }, [sessionDeleted, navigate]);

  // --- Lobby ---
  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🧠</div>
          <h1 className="text-2xl font-bold text-white mb-2">Team Training</h1>
          <p className="text-white/60">warte auf den Dozenten...</p>
          <div className="flex items-center justify-center gap-3 mt-6">
            <div className="w-3 h-3 bg-cb-accent rounded-full animate-pulse" />
            <div className="w-3 h-3 bg-cb-accent rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
            <div className="w-3 h-3 bg-cb-accent rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
        </div>
      </div>
    );
  }

  // --- Transition ---
  if (phase === 'transition' && transitionData) {
    const lastResultForTransition = result
      ? {
          correct: false,
          noBuzzes: false,
          // result.question lacks question text (stripped server-side for safety);
          // use currentQuestion which has the full object.
          questionText: result.question?.question ?? currentQuestion?.question,
          options: result.question?.options ?? currentQuestion?.options,
          correctAnswers: result.correctAnswerId ? [result.correctAnswerId] : undefined,
          explanation: result.question?.explanation,
          references: result.question?.references,
        }
      : null;

    return (
      <TransitionScreen
        currentQuestionIndex={transitionData.currentQuestionIndex}
        totalQuestions={totalQuestions}
        timeRemaining={transitionTimeLeft}
        leaderboard={transitionData.leaderboard ?? []}
        lastResult={lastResultForTransition}
      />
    );
  }

  // --- Finished ---
  if (phase === 'finished') {
    const myEntry = leaderboard.find(p => p.nickname === nickname && p.emoji === emoji);
    const myScore = myEntry?.score ?? 0;
    const myRank = myEntry ? leaderboard.indexOf(myEntry) + 1 : 0;

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-8 max-w-2xl w-full">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-2">Training abgeschlossen! 🎉</h1>
            <p className="text-xl text-cb-accent">{nickname} {emoji}</p>
          </div>

          <div className="bg-cb-primary/20 rounded-2xl p-6 mb-6 text-center border border-cb-accent/30">
            <p className="text-sm text-white/60 mb-2">Dein Ergebnis</p>
            <div className="text-4xl font-bold text-cb-accent mb-2">Platz {myRank || '—'}</div>
            <div className="text-2xl font-bold text-white">{myScore} Punkte</div>
          </div>

          <div className="bg-white/5 rounded-2xl p-4 mb-6 border border-white/10">
            <h3 className="font-semibold text-white/80 mb-3 text-center">Endstand</h3>
            <ul className="space-y-2">
              {leaderboard.slice(0, 10).map((player, index) => (
                <li
                  key={player.nickname}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                    player.nickname === nickname
                      ? 'bg-cb-primary/30 border border-cb-accent/50'
                      : 'bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        index === 0
                          ? 'bg-yellow-400 text-yellow-900'
                          : index === 1
                          ? 'bg-gray-300 text-gray-700'
                          : index === 2
                          ? 'bg-orange-300 text-orange-900'
                          : 'bg-white/10 text-white/60'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="text-xl">{player.emoji}</span>
                    <span className="font-medium text-white">{player.nickname}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-cb-accent">{player.score}</span>
                    <span className="text-sm text-white/50 ml-2">({player.correct_answers} richtig)</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <a
            href="/"
            className="w-full block bg-gradient-to-r from-cb-primary to-cb-accent hover:from-cb-accent hover:to-cb-primary text-white font-bold py-3 px-6 rounded-xl transition-all text-center"
          >
            Zur Startseite
          </a>
        </div>
      </div>
    );
  }

  // --- Question / Reveal / Result ---
  if (!currentQuestion) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center">
        <p className="text-white text-xl">Laden...</p>
      </div>
    );
  }

  const isQuestionPhase = phase === 'question';
  const isRevealPhase = phase === 'reveal';
  const isResultPhase = phase === 'result';

  // Votes shown in result phase: all votes from result (excluding own)
  const resultOtherVotes: Vote[] =
    isResultPhase && result
      ? (result.votes as Vote[]).filter(v => v.playerId !== playerId)
      : [];

  const gridOtherVotes = isResultPhase ? resultOtherVotes : otherVotes;
  const gridDisabled = !isQuestionPhase;

  // Own result entry
  const ownResult = isResultPhase && result
    ? result.votes.find(v => v.playerId === playerId)
    : null;



  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-lg rounded-t-2xl border border-white/20 border-b-0 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{emoji}</span>
              <span className="font-bold text-white">{nickname}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-white/60">
                Frage {currentQuestionIndex + 1} von {totalQuestions}
              </span>
              {isQuestionPhase && (
                <span
                  className={`font-mono font-bold text-lg px-3 py-1 rounded-lg ${
                    timeLeft < 30 ? 'bg-red-500/30 text-red-300' : 'bg-white/10 text-white'
                  }`}
                >
                  {timeLeft}s
                </span>
              )}
            </div>
          </div>

          <div className="w-full bg-white/20 rounded-full h-1.5">
            <div
              className="bg-cb-accent h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${((currentQuestionIndex + 1) / totalQuestions) * 100}%` }}
            />
          </div>
        </div>

        {/* Question card */}
        <div className="bg-white/10 backdrop-blur-lg border-x border-white/20 p-6">
          <h2 className="text-xl font-bold text-white">{currentQuestion.question}</h2>
        </div>

        {/* Grid container */}
        <div
          ref={gridContainerRef}
          className="relative bg-white/5 border-x border-white/20"
        >
          <ConfidenceGrid
            options={currentQuestion.options}
            disabled={gridDisabled}
            ownPlayerId={playerId}
            ownEmoji={emoji}
            ownVote={ownVote}
            otherVotes={gridOtherVotes}
            onVote={handleVote}
          />

          {isRevealPhase && result && (
            <TrainingReveal
              correctAnswerId={result.correctAnswerId}
              options={currentQuestion.options}
              votes={result.votes as (Vote & { correct: boolean })[]}
              containerRef={gridContainerRef}
              onComplete={handleRevealComplete}
            />
          )}
        </div>

        {/* Result card */}
        {isResultPhase && (
          <div className="bg-white/10 backdrop-blur-lg rounded-b-2xl border border-white/20 border-t-0 p-6">
            {ownResult ? (
              <div
                className={`rounded-xl p-4 mb-4 ${
                  ownResult.correct
                    ? 'bg-green-500/20 border border-green-400/30'
                    : 'bg-red-500/20 border border-red-400/30'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{ownResult.correct ? '✅' : '❌'}</span>
                  <span className="font-bold text-white text-lg">
                    {ownResult.correct ? 'Richtig!' : 'Falsch'}
                  </span>
                </div>
                <p className="text-white/80">
                  <span className="font-semibold text-cb-accent">
                    +{ownResult.pointsAwarded} Punkte
                  </span>
                  {ownResult.correct && ownResult.confidenceZone > 1 && (
                    <span className="text-white/60 ml-2">
                      (×{ownResult.confidenceZone === 2 ? '1.5' : '2.0'} Multiplikator)
                    </span>
                  )}
                </p>
              </div>
            ) : (
              <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10">
                <p className="text-white/60">Du hast nicht abgestimmt.</p>
              </div>
            )}

            {result?.question?.explanation && (
              <div className="bg-cb-primary/10 rounded-xl p-4 border border-cb-accent/20">
                <p className="font-semibold text-cb-accent mb-2">Erklärung:</p>
                <MarkdownText className="text-white/80">
                  {result.question.explanation}
                </MarkdownText>
              </div>
            )}

            {result?.question?.references && result.question.references.length > 0 && (
              <div className="bg-purple-500/10 rounded-xl p-4 border border-purple-400/20 mt-3">
                <p className="font-semibold text-purple-300 mb-2">Mehr erfahren:</p>
                <ul className="space-y-1">
                  {result.question.references.map((url, i) => (
                    <li key={i}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-300 hover:text-purple-100 hover:underline text-sm break-all"
                      >
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Bottom border strip for question/reveal phases */}
        {(isQuestionPhase || isRevealPhase) && (
          <div className="bg-white/5 rounded-b-2xl border border-white/20 border-t-0 h-3" />
        )}
      </div>
    </div>
  );
}
