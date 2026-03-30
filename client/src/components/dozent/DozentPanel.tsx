import { useState, useEffect } from 'react';
import { getSocket, authenticateAsDozent } from '../../hooks/useSocket';

interface DozentPanelProps {
  onLogout: () => void;
}

interface QuestionBank {
  bankId: string;
  label: string;
  description: string;
  questionCount: number;
  categories: Array<{ id: string; label: string; icon: string; count: number }>;
}

interface Session {
  sessionCode: string;
  createdAt: number;
  startedAt: number;
  status: 'active' | 'finished';
  totalQuestions: number;
  playerCount: number;
  gameMode: 'racing' | 'buzzer' | 'training';
  gameState: string;
  questionBank?: string;
}

interface Player {
  playerId: string;
  nickname: string;
  emoji: string;
  score: number;
  correctAnswers?: number;
}

interface BuzzerGameStatus {
  gameState: 'lobby' | 'question' | 'answering' | 'result' | 'transition' | 'finished';
  currentQuestionIndex: number;
  totalQuestions: number;
  currentAnswerer?: {
    nickname: string;
    emoji: string;
  };
  buzzes: Array<{
    position: number;
    nickname: string;
    emoji: string;
  }>;
}

type GameMode = 'racing' | 'buzzer' | 'training';

export function DozentPanel({ onLogout }: DozentPanelProps) {
  const socket = getSocket();
  const [questionCount, setQuestionCount] = useState(20);
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [existingSessions, setExistingSessions] = useState<Session[]>([]);
  const [gameMode, setGameMode] = useState<GameMode>('buzzer');
  const [questionBanks, setQuestionBanks] = useState<QuestionBank[]>([]);
  const [selectedBank, setSelectedBank] = useState<string>('azure-az104');
  const [createdGameMode, setCreatedGameMode] = useState<GameMode>('racing');
  const [joinedPlayers, setJoinedPlayers] = useState<Player[]>([]);
  const [gameStatus, setGameStatus] = useState<BuzzerGameStatus | null>(null);
  const [trainingVoteCount, setTrainingVoteCount] = useState<{ voted: number; total: number } | null>(null);
  const [trainingCorrectAnswers, setTrainingCorrectAnswers] = useState<string[] | null>(null);
  const [trainingQuestionOptions, setTrainingQuestionOptions] = useState<Array<{ id: string; text: string }>>([]);
  const [trainingResult, setTrainingResult] = useState<{
    correctAnswerId: string;
    question: { question?: string; options: Array<{ id: string; text: string }>; explanation?: string };
    votes: Array<{ nickname: string; emoji: string; correct: boolean; pointsAwarded: number }>;
  } | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [showNextRoundConfig, setShowNextRoundConfig] = useState(false);
  // Note: room join is handled via socket.on('connect') in the session effect

  const currentBank = questionBanks.find(b => b.bankId === selectedBank);
  const categories = currentBank?.categories ?? [];

  const handleBankChange = (bankId: string) => {
    setSelectedBank(bankId);
    const bank = questionBanks.find(b => b.bankId === bankId);
    if (bank) {
      setSelectedCategories(bank.categories.map(c => c.id));
    }
  };

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(c => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  const fetchQuestionBanks = async () => {
    try {
      const password = localStorage.getItem('dozent-password');
      const response = await fetch('/api/dozent/question-banks', {
        headers: { 'X-Dozent-Password': password || '' },
      });
      if (response.ok) {
        const data = await response.json();
        setQuestionBanks(data.banks);
        // Select all categories of current bank if none selected
        if (data.banks.length > 0) {
          const bank = data.banks.find((b: QuestionBank) => b.bankId === selectedBank) || data.banks[0];
          if (selectedCategories.length === 0) {
            setSelectedCategories(bank.categories.map((c: { id: string }) => c.id));
          }
          if (!data.banks.find((b: QuestionBank) => b.bankId === selectedBank)) {
            setSelectedBank(bank.bankId);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching question banks:', err);
    }
  };

  const fetchSessions = async () => {
    try {
      const password = localStorage.getItem('dozent-password');
      const response = await fetch('/api/dozent/sessions', {
        headers: {
          'X-Dozent-Password': password || '',
        },
      });

      if (response.ok) {
        const data = await response.json();
        setExistingSessions(data.sessions);
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    }
  };

  const handleDeleteSession = async (code: string) => {
    if (!confirm(`Session ${code} wirklich löschen?`)) return;

    try {
      const password = localStorage.getItem('dozent-password');
      const response = await fetch(`/api/dozent/session/${code}`, {
        method: 'DELETE',
        headers: {
          'X-Dozent-Password': password || '',
        },
      });

      if (response.ok) {
        await fetchSessions();
        if (sessionCode === code) {
          setSessionCode(null);
          setGameStarted(false);
          setGameStatus(null);
          setJoinedPlayers([]);
        }
      } else {
        alert('Fehler beim Löschen der Session');
      }
    } catch (err) {
      console.error('Error deleting session:', err);
      alert('Fehler beim Löschen der Session');
    }
  };

  const handleResetLeaderboard = async () => {
    if (!confirm('⚠️ Rangliste wirklich zurücksetzen?\n\nAlle Spieler-Punktzahlen werden unwiderruflich gelöscht!')) return;

    try {
      const password = localStorage.getItem('dozent-password');
      const response = await fetch('/api/dozent/reset-leaderboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dozent-Password': password || '',
        },
      });

      if (response.ok) {
        alert('Rangliste wurde zurückgesetzt!');
        await fetchSessions();
      } else {
        alert('Fehler beim Zurücksetzen der Rangliste');
      }
    } catch (err) {
      console.error('Error resetting leaderboard:', err);
      alert('Fehler beim Zurücksetzen der Rangliste');
    }
  };

  // Hotkey: "R" — close round (during question) or advance to next question (during result/transition)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (!socket || !sessionCode || !gameStatus) return;
        if (gameStatus.gameState === 'question') {
          if (createdGameMode === 'training') {
            handleCloseTrainingRound();
          }
        } else if (gameStatus.gameState === 'result' || gameStatus.gameState === 'transition') {
          if (createdGameMode === 'training') {
            handleForceNextTrainingQuestion();
          } else if (createdGameMode === 'buzzer') {
            handleForceNextQuestion();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [socket, sessionCode, gameStatus, createdGameMode]);

  useEffect(() => {
    fetchSessions();
    fetchQuestionBanks();
    authenticateAsDozent();
  }, []);

  // Listen for player updates and game status when a session is created
  useEffect(() => {
    if (!socket || !sessionCode) return;

    const handlePlayersUpdate = (data: { players: Player[] }) => {
      setJoinedPlayers(data.players);
    };

    const handleBuzzerState = (state: any) => {
      setGameStatus({
        gameState: state.gameState,
        currentQuestionIndex: state.currentQuestionIndex || 0,
        totalQuestions: state.totalQuestions || 0,
        buzzes: state.buzzes || [],
      });
      if (state.gameState !== 'lobby') {
        setGameStarted(true);
      }
    };

    const handleBuzzerQuestion = (data: any) => {
      setGameStatus(prev => ({
        ...prev!,
        gameState: 'question',
        currentQuestionIndex: data.questionIndex,
        totalQuestions: data.totalQuestions,
        currentAnswerer: undefined,
        buzzes: [],
      }));
      setGameStarted(true);
    };

    const handleBuzzRegistered = (data: any) => {
      setGameStatus(prev => {
        if (!prev) return prev;
        const newBuzz = {
          position: data.position,
          nickname: data.nickname,
          emoji: data.emoji,
        };
        const buzzes = [...prev.buzzes.filter(b => b.nickname !== data.nickname), newBuzz]
          .sort((a, b) => a.position - b.position);
        return { ...prev, buzzes };
      });
    };

    const handleBuzzerAnswering = (data: any) => {
      setGameStatus(prev => ({
        ...prev!,
        gameState: 'answering',
        currentAnswerer: {
          nickname: data.answerer.nickname,
          emoji: data.answerer.emoji,
        },
      }));
    };

    const handleBuzzerResult = (data: any) => {
      setGameStatus(prev => ({
        ...prev!,
        gameState: 'result',
      }));
      if (data.leaderboard) {
        setJoinedPlayers(data.leaderboard.map((p: any) => ({
          playerId: p.playerId || p.nickname,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
          correctAnswers: p.correct_answers,
        })));
      }
    };

    const handleBuzzerTransition = (data: any) => {
      setGameStatus(prev => ({
        ...prev!,
        gameState: 'transition',
        currentQuestionIndex: data.currentQuestionIndex,
      }));
      if (data.leaderboard) {
        setJoinedPlayers(data.leaderboard.map((p: any) => ({
          playerId: p.playerId || p.nickname,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
          correctAnswers: p.correct_answers,
        })));
      }
    };

    const handleBuzzerGameOver = (data: any) => {
      setGameStatus(prev => ({
        ...prev!,
        gameState: 'finished',
      }));
      if (data.leaderboard) {
        setJoinedPlayers(data.leaderboard.map((p: any) => ({
          playerId: p.playerId || p.nickname,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
          correctAnswers: p.correct_answers,
        })));
      }
    };

    const handleTrainingVoteCount = (data: { voted: number; total: number }) => {
      setTrainingVoteCount(data);
    };

    const handleTrainingQuestion = (data: any) => {
      setGameStatus(prev => ({
        ...prev!,
        gameState: 'question',
        currentQuestionIndex: data.questionIndex,
        totalQuestions: data.totalQuestions,
        currentAnswerer: undefined,
        buzzes: [],
      }));
      setGameStarted(true);
      setTrainingVoteCount(null);
      setTrainingResult(null);
      setTrainingCorrectAnswers(null);
      setTrainingQuestionOptions(data.question?.options ?? []);
    };

    const handleTrainingQuestionAnswer = (data: any) => {
      setTrainingCorrectAnswers(data.correctAnswers ?? []);
    };

    const handleTrainingState = (state: any) => {
      if (!state) return;
      const phase = state.transition ? 'transition' : state.phase;
      if (phase && phase !== 'lobby') {
        setGameStatus(prev => ({
          ...prev!,
          gameState: phase,
          currentQuestionIndex: state.currentQuestionIndex ?? 0,
          totalQuestions: state.totalQuestions ?? 0,
          currentAnswerer: undefined,
          buzzes: [],
        }));
        setGameStarted(true);
      }
      if (state.question?.options) {
        setTrainingQuestionOptions(state.question.options);
      }
      if (state.correctAnswers) {
        setTrainingCorrectAnswers(state.correctAnswers);
      }
      if (state.leaderboard) {
        setJoinedPlayers(state.leaderboard.map((p: any) => ({
          playerId: p.playerId || p.nickname,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })));
      }
    };

    const handleTrainingResult = (data: any) => {
      setGameStatus(prev => ({ ...prev!, gameState: 'result' }));
      setTrainingResult({
        correctAnswerId: data.correctAnswerId,
        question: data.question,
        votes: data.votes,
      });
      if (data.leaderboard) {
        setJoinedPlayers(data.leaderboard.map((p: any) => ({
          playerId: p.playerId || p.nickname,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })));
      }
    };

    const handleTrainingTransition = (data: any) => {
      setGameStatus(prev => ({ ...prev!, gameState: 'transition' }));
      if (data.leaderboard) {
        setJoinedPlayers(data.leaderboard.map((p: any) => ({
          playerId: p.playerId || p.nickname,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })));
      }
    };

    const handleTrainingGameOver = (data: any) => {
      setGameStatus(prev => ({ ...prev!, gameState: 'finished' }));
      if (data.leaderboard) {
        setJoinedPlayers(data.leaderboard.map((p: any) => ({
          playerId: p.playerId || p.nickname,
          nickname: p.nickname,
          emoji: p.emoji,
          score: p.score,
        })));
      }
    };

    socket.on('buzzer-players-update', handlePlayersUpdate);
    socket.on('training-players-update', handlePlayersUpdate);
    socket.on('buzzer-state', handleBuzzerState);
    socket.on('buzzer-question', handleBuzzerQuestion);
    socket.on('buzz-registered', handleBuzzRegistered);
    socket.on('buzzer-answering', handleBuzzerAnswering);
    socket.on('buzzer-result', handleBuzzerResult);
    socket.on('buzzer-transition', handleBuzzerTransition);
    socket.on('buzzer-game-over', handleBuzzerGameOver);
    socket.on('training-vote-count', handleTrainingVoteCount);
    socket.on('training-state', handleTrainingState);
    socket.on('training-question', handleTrainingQuestion);
    socket.on('training-question-answer', handleTrainingQuestionAnswer);
    socket.on('training-result', handleTrainingResult);
    socket.on('training-transition', handleTrainingTransition);
    socket.on('training-game-over', handleTrainingGameOver);

    // Join (or re-join) the session room. Must fire on every connect/reconnect
    // because Socket.IO drops room membership when the connection resets.
    const joinAndSync = () => {
      socket.emit('join-session', sessionCode);
      socket.emit('buzzer-get-state', sessionCode);
      if (createdGameMode === 'training') {
        socket.emit('training-get-state', sessionCode);
      }
    };

    if (socket.connected) {
      joinAndSync();
    }
    socket.on('connect', joinAndSync);

    return () => {
      socket.off('connect', joinAndSync);
      socket.off('buzzer-players-update', handlePlayersUpdate);
      socket.off('training-players-update', handlePlayersUpdate);
      socket.off('buzzer-state', handleBuzzerState);
      socket.off('buzzer-question', handleBuzzerQuestion);
      socket.off('buzz-registered', handleBuzzRegistered);
      socket.off('buzzer-answering', handleBuzzerAnswering);
      socket.off('buzzer-result', handleBuzzerResult);
      socket.off('buzzer-transition', handleBuzzerTransition);
      socket.off('buzzer-game-over', handleBuzzerGameOver);
      socket.off('training-vote-count', handleTrainingVoteCount);
      socket.off('training-state', handleTrainingState);
      socket.off('training-question', handleTrainingQuestion);
      socket.off('training-question-answer', handleTrainingQuestionAnswer);
      socket.off('training-result', handleTrainingResult);
      socket.off('training-transition', handleTrainingTransition);
      socket.off('training-game-over', handleTrainingGameOver);
    };
  }, [socket, sessionCode]);

  const handleCreateSession = async () => {
    if (selectedCategories.length === 0) {
      setError('Bitte wählen Sie mindestens eine Kategorie aus');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/dozent/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: localStorage.getItem('dozent-password'),
          totalQuestions: questionCount,
          categories: selectedCategories,
          gameMode: gameMode,
          questionBank: selectedBank,
        }),
      });

      if (!response.ok) {
        throw new Error('Fehler beim Erstellen der Session');
      }

      const data = await response.json();
      setSessionCode(data.sessionCode);
      setCreatedGameMode(data.gameMode || 'racing');
      setGameStarted(false);
      setGameStatus(null);
      setJoinedPlayers([]);
      setShowNextRoundConfig(false);
      // Sync with actual question count (may be less than requested if not enough qualifying questions)
      if (data.actualQuestions) setQuestionCount(data.actualQuestions);
      await fetchSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  };

  const handleContinueSession = async () => {
    if (!sessionCode || selectedCategories.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      const password = localStorage.getItem('dozent-password');
      const response = await fetch(`/api/dozent/session/${sessionCode}/continue`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Dozent-Password': password || '',
        },
        body: JSON.stringify({
          totalQuestions: questionCount,
          categories: selectedCategories,
          questionBank: selectedBank,
        }),
      });

      if (!response.ok) {
        throw new Error('Fehler beim Fortsetzen der Session');
      }

      setShowNextRoundConfig(false);
      setGameStarted(false);
      setGameStatus(prev => prev ? { ...prev, gameState: 'lobby' } : null);
      await fetchSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  };

  const handleStartBuzzerGame = () => {
    if (!socket || !sessionCode) return;
    socket.emit('buzzer-start-game', sessionCode);
    setGameStarted(true);
  };

  const handleForceNextQuestion = () => {
    if (!socket || !sessionCode) return;
    socket.emit('buzzer-force-next', sessionCode);
  };

  const handleEndGame = () => {
    if (!socket || !sessionCode) return;
    if (confirm('Spiel wirklich beenden?')) {
      socket.emit('buzzer-force-end', sessionCode);
    }
  };

  const handleStartTrainingGame = () => {
    if (!socket || !sessionCode) return;
    socket.emit('training-start-game', sessionCode);
    setGameStarted(true);
  };

  const handleCloseTrainingRound = () => {
    if (!socket || !sessionCode) return;
    socket.emit('training-close-round', sessionCode);
  };

  const handleForceNextTrainingQuestion = () => {
    if (!socket || !sessionCode) return;
    socket.emit('training-force-next', sessionCode);
  };

  const handleEndTrainingGame = () => {
    if (!socket || !sessionCode) return;
    if (confirm('Spiel wirklich beenden?')) {
      socket.emit('training-force-end', sessionCode);
    }
  };

  const handleManageSession = (session: Session) => {
    setSessionCode(session.sessionCode);
    setCreatedGameMode(session.gameMode);
    setGameStarted(session.gameState !== 'lobby');
    setShowNextRoundConfig(false);
    setTrainingVoteCount(null);
    // Sync slider with session's actual question count
    setQuestionCount(session.totalQuestions);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const getGameStateLabel = (state: string) => {
    switch (state) {
      case 'lobby': return { label: 'Warteraum', color: 'bg-yellow-500/20 text-yellow-300 border border-yellow-400/30' };
      case 'question': return { label: 'Buzz-Phase', color: 'bg-blue-500/20 text-blue-300 border border-blue-400/30' };
      case 'answering': return { label: 'Antwort-Phase', color: 'bg-purple-500/20 text-purple-300 border border-purple-400/30' };
      case 'result': return { label: 'Ergebnis', color: 'bg-green-500/20 text-green-300 border border-green-400/30' };
      case 'transition': return { label: 'Pause', color: 'bg-gray-500/20 text-gray-300 border border-gray-400/30' };
      case 'finished': return { label: 'Beendet', color: 'bg-red-500/20 text-red-300 border border-red-400/30' };
      default: return { label: state, color: 'bg-gray-500/20 text-gray-300 border border-gray-400/30' };
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    if (hours > 0) return `vor ${hours}h`;
    if (minutes > 0) return `vor ${minutes}min`;
    return 'gerade eben';
  };

  const sessionUrl = sessionCode
    ? `${window.location.origin}/session/${sessionCode}`
    : '';

  const arenaUrl = sessionCode
    ? `${window.location.origin}/arena/${sessionCode}`
    : '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur rounded-2xl p-4 mb-6 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-black text-white">
              CERTBUZZ
            </h1>
            <span className="px-3 py-1 bg-cb-primary/30 text-cb-accent text-sm font-medium rounded-full">
              Dozenten-Panel
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/leaderboard"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-400/30 rounded-lg text-yellow-300 text-sm font-medium transition-colors"
            >
              <span>🏆</span>
              <span>Rangliste</span>
            </a>
            <button
              onClick={handleResetLeaderboard}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 rounded-lg text-red-300 text-sm font-medium transition-colors"
              title="Rangliste zurücksetzen"
            >
              <span>🗑️</span>
              <span>Reset</span>
            </button>
            <button
              onClick={onLogout}
              className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
            >
              Abmelden
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Panel */}
          <div className="lg:col-span-2">
            <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-6">
              {!sessionCode ? (
                <>
                  <h2 className="text-2xl font-bold text-white mb-6">Neue Session erstellen</h2>

                  {/* Question Bank Selection */}
                  {questionBanks.length > 1 && (
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-white/70 mb-3">
                        Fragenbank
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {questionBanks.map(bank => (
                          <button
                            key={bank.bankId}
                            type="button"
                            onClick={() => handleBankChange(bank.bankId)}
                            className={`p-4 rounded-xl border-2 transition-all text-left ${
                              selectedBank === bank.bankId
                                ? 'border-cb-accent bg-cb-primary/30 shadow-lg'
                                : 'border-white/20 bg-white/5 hover:border-white/40'
                            }`}
                          >
                            <div className="font-bold text-white">{bank.label}</div>
                            <div className="text-sm text-white/60 mt-1">{bank.description}</div>
                            <div className="text-xs text-white/40 mt-2">{bank.questionCount} Fragen</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Game Mode Selection */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-white/70 mb-3">
                      Spielmodus
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <button
                        type="button"
                        onClick={() => setGameMode('racing')}
                        className={`p-4 rounded-xl border-2 transition-all text-left ${
                          gameMode === 'racing'
                            ? 'border-cb-accent bg-cb-primary/30 shadow-lg'
                            : 'border-white/20 bg-white/5 hover:border-white/40'
                        }`}
                      >
                        <div className="text-3xl mb-2">🏎️</div>
                        <div className="font-bold text-white">Racing-Modus</div>
                        <div className="text-sm text-white/60 mt-1">
                          Jeder spielt in seinem eigenen Tempo.
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setGameMode('buzzer')}
                        className={`p-4 rounded-xl border-2 transition-all text-left ${
                          gameMode === 'buzzer'
                            ? 'border-purple-400 bg-purple-500/30 shadow-lg'
                            : 'border-white/20 bg-white/5 hover:border-white/40'
                        }`}
                      >
                        <div className="text-3xl mb-2">🔔</div>
                        <div className="font-bold text-white">Buzzer-Modus</div>
                        <div className="text-sm text-white/60 mt-1">
                          Wer zuerst buzzert, darf antworten.
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setGameMode('training')}
                        className={`p-4 rounded-xl border-2 transition-all text-left ${
                          gameMode === 'training'
                            ? 'border-teal-400 bg-teal-500/30 shadow-lg'
                            : 'border-white/20 bg-white/5 hover:border-white/40'
                        }`}
                      >
                        <div className="text-3xl mb-2">🧠</div>
                        <div className="font-bold text-white">Team Training</div>
                        <div className="text-sm text-white/60 mt-1">
                          Gemeinsam abstimmen mit Konfidenz-Tipp.
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Question Count */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-white/70 mb-2">
                      Anzahl der Fragen
                    </label>
                    <input
                      type="range"
                      min="5"
                      max="50"
                      value={questionCount}
                      onChange={(e) => setQuestionCount(Number(e.target.value))}
                      className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-cb-accent"
                    />
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-sm text-white/50">5</span>
                      <span className="text-2xl font-bold text-cb-accent">{questionCount}</span>
                      <span className="text-sm text-white/50">50</span>
                    </div>
                  </div>

                  {/* Categories */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-white/70 mb-3">
                      Themenkomplexe
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {categories.map(category => (
                        <button
                          key={category.id}
                          onClick={() => toggleCategory(category.id)}
                          className={`p-3 rounded-lg text-left transition-all ${
                            selectedCategories.includes(category.id)
                              ? 'bg-cb-primary text-white shadow-md'
                              : 'bg-white/10 text-white/70 hover:bg-white/20'
                          }`}
                        >
                          <span className="text-xl mr-2">{category.icon}</span>
                          <span className="text-sm font-medium">{category.label}</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-sm text-white/50 mt-2">
                      {selectedCategories.length} von {categories.length} ausgewählt
                    </p>
                  </div>

                  {error && (
                    <div className="mb-4 p-4 bg-red-500/20 border border-red-400/30 rounded-lg text-red-300">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handleCreateSession}
                    disabled={loading || selectedCategories.length === 0}
                    className="w-full bg-gradient-to-r from-cb-primary to-cb-accent hover:from-cb-accent hover:to-cb-primary text-white font-bold py-4 px-6 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg shadow-lg"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Erstelle Session...
                      </span>
                    ) : (
                      `${gameMode === 'buzzer' ? '🔔' : gameMode === 'training' ? '🧠' : '🏎️'} Session starten`
                    )}
                  </button>
                </>
              ) : (
                <div className="space-y-6">
                  {/* Session Header */}
                  <div className="p-6 bg-green-500/20 border-2 border-green-400/30 rounded-xl">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">
                          {createdGameMode === 'buzzer' ? '🔔' : createdGameMode === 'training' ? '🧠' : '🏎️'}
                        </span>
                        <div>
                          <p className="text-green-300 font-bold text-lg">
                            Session aktiv
                          </p>
                          <p className="text-green-400/70 text-sm">
                            {createdGameMode === 'buzzer' ? 'Buzzer-Modus' : createdGameMode === 'training' ? 'Team Training' : 'Racing-Modus'}
                          </p>
                        </div>
                      </div>
                      {gameStatus && (
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getGameStateLabel(gameStatus.gameState).color}`}>
                          {getGameStateLabel(gameStatus.gameState).label}
                        </span>
                      )}
                    </div>

                    {/* Session Code */}
                    <div className="flex items-center gap-4 mb-3">
                      <code className="flex-1 px-6 py-4 bg-white/10 border-2 border-green-400/50 rounded-xl text-4xl font-mono font-black text-center tracking-widest text-white">
                        {sessionCode}
                      </code>
                      <button
                        onClick={() => copyToClipboard(sessionCode!, 'code')}
                        className={`px-4 py-4 rounded-xl transition-all ${
                          copied === 'code' 
                            ? 'bg-green-500 text-white' 
                            : 'bg-white/10 hover:bg-white/20 border-2 border-white/20 text-white'
                        }`}
                      >
                        {copied === 'code' ? '✓' : '📋'}
                      </button>
                    </div>

                    {/* Join URL */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={sessionUrl}
                        readOnly
                        className="flex-1 px-3 py-2 bg-white/10 border border-green-400/30 rounded-lg text-sm font-mono text-white/80"
                      />
                      <button
                        onClick={() => copyToClipboard(sessionUrl, 'url')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          copied === 'url'
                            ? 'bg-green-500 text-white'
                            : 'bg-white/10 hover:bg-white/20 border border-white/20 text-white'
                        }`}
                      >
                        {copied === 'url' ? 'Kopiert!' : 'URL kopieren'}
                      </button>
                    </div>
                  </div>

                  {/* Game Status (for Buzzer Mode) */}
                  {createdGameMode === 'buzzer' && gameStatus && gameStatus.gameState !== 'lobby' && gameStatus.gameState !== 'finished' && (
                    <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className="text-2xl font-bold text-cb-accent">
                            {gameStatus.currentQuestionIndex + 1}/{gameStatus.totalQuestions}
                          </div>
                          <div className="text-xs text-white/50">Frage</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-purple-400">
                            {gameStatus.buzzes.length}
                          </div>
                          <div className="text-xs text-white/50">Buzzer</div>
                        </div>
                        <div>
                          <div className="text-2xl">
                            {gameStatus.currentAnswerer ? `${gameStatus.currentAnswerer.emoji}` : '-'}
                          </div>
                          <div className="text-xs text-white/50">Antwortet</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Next Round Config */}
                  {(showNextRoundConfig || gameStatus?.gameState === 'finished') && (
                    <div className="p-4 bg-blue-500/20 border-2 border-blue-400/30 rounded-xl">
                      <h3 className="font-bold text-blue-300 mb-4">Nächste Runde konfigurieren</h3>
                      
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-blue-300/80 mb-2">
                          Anzahl der Fragen
                        </label>
                        <input
                          type="range"
                          min="5"
                          max="50"
                          value={questionCount}
                          onChange={(e) => setQuestionCount(Number(e.target.value))}
                          className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-400"
                        />
                        <div className="text-center text-xl font-bold text-blue-400 mt-1">{questionCount}</div>
                      </div>

                      <div className="mb-4">
                        <label className="block text-sm font-medium text-blue-300/80 mb-2">
                          Themenkomplexe
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {categories.map(category => (
                            <button
                              key={category.id}
                              onClick={() => toggleCategory(category.id)}
                              className={`px-3 py-1 rounded-full text-sm transition-all ${
                                selectedCategories.includes(category.id)
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-white/10 text-blue-300 border border-blue-400/30'
                              }`}
                            >
                              {category.icon} {category.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={handleContinueSession}
                        disabled={loading || selectedCategories.length === 0}
                        className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-500/50 text-white font-bold py-3 px-6 rounded-lg transition-colors"
                      >
                        {loading ? 'Laden...' : '▶️ Runde starten'}
                      </button>
                    </div>
                  )}

                  {/* Buzzer Mode Controls */}
                  {createdGameMode === 'buzzer' && !showNextRoundConfig && (
                    <div className="p-4 bg-purple-500/20 border-2 border-purple-400/30 rounded-xl">
                      {!gameStarted || gameStatus?.gameState === 'lobby' ? (
                        <>
                          <div className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-purple-300 font-semibold">
                                Spieler im Warteraum:
                              </p>
                              <span className="bg-purple-500/30 text-purple-300 px-3 py-1 rounded-full text-sm font-bold border border-purple-400/30">
                                {joinedPlayers.length}
                              </span>
                            </div>
                            
                            {joinedPlayers.length === 0 ? (
                              <div className="bg-white/5 rounded-lg p-4 text-center text-white/50 border border-purple-400/20">
                                <div className="animate-pulse">Warte auf Spieler...</div>
                              </div>
                            ) : (
                              <div className="bg-white/5 rounded-lg border border-purple-400/20 max-h-32 overflow-y-auto">
                                <div className="flex flex-wrap gap-2 p-3">
                                  {joinedPlayers.map((player) => (
                                    <span key={player.playerId} className="px-3 py-1 bg-purple-500/30 rounded-full text-sm text-white">
                                      {player.emoji} {player.nickname}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <button
                            onClick={handleStartBuzzerGame}
                            disabled={joinedPlayers.length === 0}
                            className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-500/50 disabled:to-gray-600/50 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-xl transition-all text-lg shadow-lg"
                          >
                            🎮 Spiel starten! {joinedPlayers.length > 0 && `(${joinedPlayers.length} Spieler)`}
                          </button>
                        </>
                      ) : gameStatus?.gameState === 'finished' ? (
                        <p className="text-purple-300 font-bold text-center py-2">Spiel beendet — konfiguriere unten die nächste Runde.</p>
                      ) : (
                        <>
                          <h3 className="font-bold text-purple-300 mb-3">Spiel-Steuerung</h3>
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              onClick={handleForceNextQuestion}
                              className="px-4 py-3 bg-yellow-500 hover:bg-yellow-600 text-white font-medium rounded-lg transition-colors"
                            >
                              ⏭️ Nächste Frage
                            </button>
                            <button
                              onClick={handleEndGame}
                              className="px-4 py-3 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors"
                            >
                              🛑 Spiel beenden
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Training Mode Controls */}
                  {createdGameMode === 'training' && (
                    <div className="space-y-3">
                      {!gameStarted ? (
                        <>
                          {/* Player list in lobby */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-teal-300 font-semibold">
                                Spieler im Warteraum:
                              </p>
                              <span className="bg-teal-500/30 text-teal-300 px-3 py-1 rounded-full text-sm font-bold border border-teal-400/30">
                                {joinedPlayers.length}
                              </span>
                            </div>
                            {joinedPlayers.length === 0 ? (
                              <div className="bg-white/5 rounded-lg p-4 text-center text-white/50 border border-teal-400/20 mb-2">
                                <div className="animate-pulse">Warte auf Spieler...</div>
                              </div>
                            ) : (
                              <div className="bg-white/5 rounded-lg border border-teal-400/20 max-h-32 overflow-y-auto mb-2">
                                <div className="flex flex-wrap gap-2 p-3">
                                  {joinedPlayers.map((player) => (
                                    <span key={player.playerId} className="px-3 py-1 bg-teal-500/30 rounded-full text-sm text-white">
                                      {player.emoji} {player.nickname}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={handleStartTrainingGame}
                            disabled={joinedPlayers.length === 0}
                            className="w-full bg-teal-600 hover:bg-teal-500 disabled:bg-gray-500/50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all"
                          >
                            🧠 Spiel starten {joinedPlayers.length > 0 && `(${joinedPlayers.length} Spieler)`}
                          </button>
                        </>
                      ) : gameStatus?.gameState === 'finished' ? (
                        <p className="text-teal-300 font-bold text-center py-2">Training abgeschlossen — konfiguriere unten die nächste Runde.</p>
                      ) : (
                        <>
                          {gameStatus && gameStatus.gameState === 'question' && (
                            <div className="space-y-3">
                              {/* Show correct answer for dozent during question */}
                              {trainingCorrectAnswers && trainingQuestionOptions.length > 0 && (
                                <div className="p-3 bg-white/5 rounded-xl border border-teal-400/20 space-y-1">
                                  {trainingQuestionOptions.map(opt => {
                                    const isCorrect = trainingCorrectAnswers.includes(opt.id);
                                    return (
                                      <div
                                        key={opt.id}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                                          isCorrect
                                            ? 'bg-green-500/30 border border-green-400/40 text-green-200 font-semibold'
                                            : 'bg-white/5 text-white/50'
                                        }`}
                                      >
                                        <span>{isCorrect ? '✓' : '·'}</span>
                                        <span>{opt.text}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {trainingVoteCount && (
                                <div className="p-3 bg-white/5 rounded-xl text-center">
                                  <span className="text-white font-bold text-2xl">{trainingVoteCount.voted}</span>
                                  <span className="text-white/50"> / {trainingVoteCount.total} haben abgestimmt</span>
                                </div>
                              )}
                              <button
                                onClick={handleCloseTrainingRound}
                                className="w-full bg-cb-primary hover:bg-cb-accent text-white font-bold py-3 rounded-xl transition-all"
                              >
                                Runde schließen <span className="text-white/50 text-sm ml-1">(R)</span>
                              </button>
                            </div>
                          )}
                          {gameStatus && (gameStatus.gameState === 'result' || gameStatus.gameState === 'transition') && (
                            <>
                              {/* Show correct answer after round closes */}
                              {trainingResult && (
                                <div className="p-3 bg-white/5 rounded-xl border border-teal-400/20 space-y-2">
                                  <div className="space-y-1">
                                    {trainingResult.question.options.map(opt => {
                                      const isCorrect = opt.id === trainingResult.correctAnswerId;
                                      return (
                                        <div
                                          key={opt.id}
                                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                                            isCorrect
                                              ? 'bg-green-500/30 border border-green-400/40 text-green-200 font-semibold'
                                              : 'bg-white/5 text-white/50'
                                          }`}
                                        >
                                          <span>{isCorrect ? '✓' : '·'}</span>
                                          <span>{opt.text}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="text-xs text-white/40 text-center">
                                    {trainingResult.votes.filter(v => v.correct).length} / {trainingResult.votes.length} richtig
                                  </div>
                                </div>
                              )}
                              <button
                                onClick={handleForceNextTrainingQuestion}
                                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all"
                              >
                                Nächste Frage → <span className="text-white/50 text-sm ml-1">(R)</span>
                              </button>
                            </>
                          )}
                          <button
                            onClick={handleEndTrainingGame}
                            className="w-full bg-red-600/70 hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-all"
                          >
                            Spiel beenden
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Quick Links */}
                  {createdGameMode === 'buzzer' && (
                    <a
                      href={arenaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-3 p-4 bg-purple-500/20 hover:bg-purple-500/30 rounded-xl transition-colors text-center border border-purple-400/30"
                    >
                      <span className="text-2xl">🏟️</span>
                      <span className="font-medium text-purple-300">Arena öffnen (Beamer)</span>
                    </a>
                  )}

                  {/* Back Button */}
                  <button
                    onClick={() => {
                      setSessionCode(null);
                      setGameStarted(false);
                      setGameStatus(null);
                      setJoinedPlayers([]);
                      setShowNextRoundConfig(false);
                      fetchSessions();
                    }}
                    className="w-full bg-white/10 hover:bg-white/20 text-white/80 font-medium py-3 px-6 rounded-xl transition-colors border border-white/10"
                  >
                    ← Zurück zur Übersicht
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Live Leaderboard (when game started) */}
            {sessionCode && gameStarted && joinedPlayers.length > 0 && (
              <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-6">
                <h3 className="font-bold text-white mb-4">Live-Rangliste</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {[...joinedPlayers]
                    .sort((a, b) => (b.score || 0) - (a.score || 0))
                    .map((player, index) => (
                    <div
                      key={player.playerId}
                      className="flex items-center gap-3 p-2 bg-white/5 rounded-lg"
                    >
                      <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                        index === 0 ? 'bg-yellow-400 text-yellow-900' :
                        index === 1 ? 'bg-gray-300 text-gray-700' :
                        index === 2 ? 'bg-orange-300 text-orange-900' :
                        'bg-white/10 text-white/60'
                      }`}>
                        {index + 1}
                      </span>
                      <span className="text-lg">{player.emoji}</span>
                      <span className="flex-1 font-medium text-sm truncate text-white">{player.nickname}</span>
                      <span className="font-bold text-cb-accent">{player.score || 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Session Management (in sidebar when no session selected) */}
            {!sessionCode && (
              <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-6">
                <h3 className="font-bold text-white mb-4">
                  Sessions ({existingSessions.length})
                </h3>
                
                {existingSessions.length === 0 ? (
                  <p className="text-white/50 text-sm text-center py-4">
                    Keine aktiven Sessions
                  </p>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {existingSessions.map((session) => (
                      <div
                        key={session.sessionCode}
                        className="p-3 bg-white/5 rounded-lg border border-white/10"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <code className="font-mono font-bold text-lg text-white">
                            {session.sessionCode}
                          </code>
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                            session.gameMode === 'buzzer'
                              ? 'bg-purple-500/30 text-purple-300 border border-purple-400/30'
                              : session.gameMode === 'training'
                              ? 'bg-teal-500/30 text-teal-300 border border-teal-400/30'
                              : 'bg-blue-500/30 text-blue-300 border border-blue-400/30'
                          }`}>
                            {session.gameMode === 'buzzer' ? '🔔' : session.gameMode === 'training' ? '🧠' : '🏎️'}
                          </span>
                        </div>
                        <div className="text-xs text-white/50 mb-2">
                          {session.playerCount} Spieler • {session.totalQuestions} Fragen • {formatTimeAgo(session.createdAt)}
                          {session.questionBank && session.questionBank !== 'azure-az104' && (
                            <> • {questionBanks.find(b => b.bankId === session.questionBank)?.label || session.questionBank}</>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleManageSession(session)}
                            className="flex-1 px-3 py-1.5 text-xs bg-green-500/20 hover:bg-green-500/30 text-green-300 rounded transition-colors font-medium border border-green-400/30"
                          >
                            Verwalten
                          </button>
                          <button
                            onClick={() => handleDeleteSession(session.sessionCode)}
                            className="px-3 py-1.5 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded transition-colors border border-red-400/30"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
