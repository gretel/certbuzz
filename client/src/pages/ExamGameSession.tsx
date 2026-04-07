import { useEffect, useState, useCallback } from 'react';
import { getSocket } from '../hooks/useSocket';
import { useExamTimer, formatExamTime, examTimerColor } from '../hooks/useExamTimer';
import { SingleChoice } from '../components/game/SingleChoice';
import { MultipleChoice } from '../components/game/MultipleChoice';
import { OrderQuestion } from '../components/game/OrderQuestion';
import { MarkdownText } from '../components/shared/MarkdownText';

interface ExamQuestion {
  id: string;
  category: string;
  type: 'single' | 'multiple' | 'order';
  difficulty: string;
  question: string;
  options: Array<{ id: string; text: string }>;
  correctAnswers?: string[]; // Only present in review payload, not during exam
  explanation?: string;
  references?: string[];
}

interface ExamGameSessionProps {
  sessionCode: string;
  totalQuestions: number;
  playerId: string;
  nickname: string;
  emoji: string;
}

type Stage = 'loading' | 'pre-exam' | 'in-progress' | 'submitting' | 'results';

interface ExamStateResponse {
  examStartedAt: number | null;
  currentQuestion: number;
  finishedAt: number | null;
  totalQuestions: number;
  durationMinutes: number;
}

interface DomainBreakdown {
  id: string;
  label: string;
  total: number;
  correct: number;
}

interface ReviewItem {
  question: ExamQuestion & { correctAnswers: string[]; explanation: string };
  selectedAnswers: string[];
  correct: boolean;
  timeSeconds: number;
}

interface ExamResults {
  scaled: number;
  percentage: number;
  correctCount: number;
  totalQuestions: number;
  passed: boolean;
  passingScore: number;
  durationMinutes: number;
  elapsedSeconds: number;
  byDomain: DomainBreakdown[];
  review: ReviewItem[];
}

export function ExamGameSession({
  sessionCode,
  totalQuestions: initialTotalQuestions,
  playerId,
  nickname,
}: ExamGameSessionProps) {
  const [stage, setStage] = useState<Stage>('loading');
  const [examStartedAt, setExamStartedAt] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([]);
  const [questionStartMs, setQuestionStartMs] = useState(Date.now());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [results, setResults] = useState<ExamResults | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Fetched per-player so retakes can swap questions without leaving the page
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [totalQuestions, setTotalQuestions] = useState<number>(initialTotalQuestions);

  const remaining = useExamTimer(examStartedAt, durationMinutes);

  // Fetch this player's effective question list (per-player override after retake,
  // or session-wide list on first attempt). Returns the questions array.
  const loadQuestions = useCallback(async (): Promise<ExamQuestion[]> => {
    const res = await fetch(`/api/player/${playerId}/exam-questions`);
    if (!res.ok) throw new Error(`exam-questions HTTP ${res.status}`);
    const data = await res.json();
    setQuestions(data.questions);
    setTotalQuestions(data.totalQuestions);
    return data.questions;
  }, [playerId]);

  // === RESUME: fetch exam state + questions on mount ===
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Always fetch state first to know which stage to render
        const stateRes = await fetch(`/api/player/${playerId}/exam-state`);
        if (!stateRes.ok) throw new Error(`exam-state HTTP ${stateRes.status}`);
        const state: ExamStateResponse = await stateRes.json();
        if (cancelled) return;

        setDurationMinutes(state.durationMinutes);

        if (state.finishedAt) {
          // Already submitted — fetch review only (questions are embedded in review.review[].question)
          const reviewRes = await fetch(`/api/player/${playerId}/exam-review`);
          if (!reviewRes.ok) throw new Error(`exam-review HTTP ${reviewRes.status}`);
          const reviewData: ExamResults = await reviewRes.json();
          if (cancelled) return;
          setResults(reviewData);
          setStage('results');
        } else {
          // pre-exam or in-progress — both need the question list
          await loadQuestions();
          if (cancelled) return;

          if (state.examStartedAt) {
            setExamStartedAt(state.examStartedAt);
            setCurrentIndex(state.currentQuestion);
            setQuestionStartMs(Date.now());
            setStage('in-progress');
          } else {
            setStage('pre-exam');
          }
        }
      } catch (err: any) {
        console.error('[exam] failed to fetch state', err);
        if (!cancelled) setFetchError(err?.message ?? 'Verbindungsfehler');
      }
    })();
    return () => { cancelled = true; };
  }, [playerId, loadQuestions]);

  // Reset per-question start time whenever the question index changes while in-progress
  useEffect(() => {
    if (stage === 'in-progress') {
      setQuestionStartMs(Date.now());
      setSelectedAnswers([]);
    }
  }, [currentIndex, stage]);

  const handleStartExam = async () => {
    try {
      const res = await fetch(`/api/player/${playerId}/exam-start`, { method: 'POST' });
      if (!res.ok) throw new Error(`exam-start HTTP ${res.status}`);
      const data = await res.json();
      setExamStartedAt(data.examStartedAt);
      setCurrentIndex(0);
      setQuestionStartMs(Date.now());
      setStage('in-progress');
    } catch (err: any) {
      alert(`Fehler beim Starten der Prüfung: ${err?.message ?? 'unbekannt'}`);
    }
  };

  const handleFinalize = useCallback(async () => {
    setStage('submitting');
    try {
      const res = await fetch(`/api/player/${playerId}/exam-submit`, { method: 'POST' });
      if (!res.ok) throw new Error(`exam-submit HTTP ${res.status}`);
      const data: ExamResults = await res.json();
      setResults(data);
      setStage('results');
    } catch (err: any) {
      console.error('[exam] finalize failed', err);
      alert(`Fehler beim Abschicken: ${err?.message ?? 'unbekannt'}`);
      setStage('in-progress');
    }
  }, [playerId]);

  // Restart the exam with a freshly sampled question set. Server resamples,
  // overrides player.question_ids, and clears all progress.
  const handleRestart = useCallback(async () => {
    if (!confirm('Erneut versuchen? Du bekommst eine neue Auswahl von 65 Fragen. Dein bisheriges Ergebnis wird verworfen.')) {
      return;
    }
    setStage('loading');
    try {
      const restartRes = await fetch(`/api/player/${playerId}/exam-restart`, { method: 'POST' });
      if (!restartRes.ok) throw new Error(`exam-restart HTTP ${restartRes.status}`);

      // Reload fresh questions and reset all client state
      await loadQuestions();
      setExamStartedAt(null);
      setCurrentIndex(0);
      setSelectedAnswers([]);
      setQuestionStartMs(Date.now());
      setResults(null);
      setStage('pre-exam');
    } catch (err: any) {
      console.error('[exam] restart failed', err);
      alert(`Fehler beim Neustart: ${err?.message ?? 'unbekannt'}`);
      // Try to recover by going back to results
      setStage('results');
    }
  }, [playerId, loadQuestions]);

  const handleSubmitAnswer = useCallback(async () => {
    if (isSubmitting || selectedAnswers.length === 0) return;
    const question = questions[currentIndex];
    if (!question) return;

    setIsSubmitting(true);
    const timeSeconds = (Date.now() - questionStartMs) / 1000;
    const socket = getSocket();

    if (!socket) {
      setIsSubmitting(false);
      alert('Keine Verbindung zum Server. Bitte die Seite neu laden.');
      return;
    }

    const ack = await new Promise<any>(resolve => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 5000);
      socket.emit('submit-exam-answer', {
        sessionCode,
        playerId,
        questionId: question.id,
        selectedAnswers,
        timeSeconds,
      }, (res: any) => {
        clearTimeout(timer);
        resolve(res);
      });
    });

    setIsSubmitting(false);

    if (!ack.ok && !ack.alreadyAnswered) {
      alert(`Fehler beim Speichern: ${ack.error ?? 'Unbekannt'}`);
      return;
    }

    const next = currentIndex + 1;
    if (next >= totalQuestions) {
      await handleFinalize();
    } else {
      setCurrentIndex(next);
    }
  }, [
    isSubmitting,
    selectedAnswers,
    questions,
    currentIndex,
    questionStartMs,
    sessionCode,
    playerId,
    totalQuestions,
    handleFinalize,
  ]);

  // Keyboard shortcuts during the exam: digits 1..9 select/toggle options,
  // Enter submits the current answer. Order questions don't get number
  // shortcuts (drag-and-drop), but Enter still advances if a valid order is set.
  useEffect(() => {
    if (stage !== 'in-progress') return;
    const question = questions[currentIndex];
    if (!question) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Don't hijack browser shortcuts or shortcuts inside text inputs
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      // Digit shortcut: select option by index (1 -> first option, 2 -> second, ...)
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        if (idx >= question.options.length) return;
        const optId = question.options[idx].id;

        if (question.type === 'single') {
          e.preventDefault();
          setSelectedAnswers([optId]);
        } else if (question.type === 'multiple') {
          e.preventDefault();
          setSelectedAnswers(prev =>
            prev.includes(optId) ? prev.filter(id => id !== optId) : [...prev, optId]
          );
        }
        return;
      }

      // Enter: advance to next question / finalize on last
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (selectedAnswers.length > 0 && !isSubmitting) {
          handleSubmitAnswer();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stage, questions, currentIndex, selectedAnswers, isSubmitting, handleSubmitAnswer]);

  // ============ RENDER ============

  if (stage === 'loading') {
    return (
      <div className="min-h-screen bg-cb-dark flex items-center justify-center">
        <div className="text-white text-xl">
          {fetchError ? (
            <span className="text-red-400">Fehler: {fetchError}</span>
          ) : (
            'Prüfung wird geladen...'
          )}
        </div>
      </div>
    );
  }

  if (stage === 'pre-exam') {
    return (
      <div className="min-h-screen bg-cb-dark flex items-center justify-center p-4">
        <div className="max-w-2xl bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-8 text-white shadow-2xl">
          <div className="text-center mb-6">
            <div className="text-6xl mb-2">🎓</div>
            <h1 className="text-3xl font-bold">AWS CLF-C02</h1>
            <p className="text-lg opacity-80">Prüfungssimulation</p>
          </div>

          <div className="space-y-3 mb-8 text-base">
            <div>📝 <strong>{totalQuestions} Fragen</strong></div>
            <div>⏱️ <strong>{durationMinutes} Minuten Zeit</strong></div>
            <div>🎯 <strong>Bestehen ab 700/1000</strong> (≈ 44 richtig)</div>
            <div>🚫 <strong>Keine Erklärungen während der Prüfung</strong> — Auswertung erst am Ende.</div>
            <div>⬆️ <strong>Keine Rückkehr zu beantworteten Fragen.</strong></div>
            <div>💤 <strong>Pause möglich</strong> — du kannst das Fenster schließen und später weitermachen; die Zeit läuft weiter.</div>
          </div>

          <button
            onClick={handleStartExam}
            className="w-full bg-cb-accent hover:brightness-110 text-white text-xl font-bold py-4 rounded-lg transition-all"
          >
            Prüfung starten
          </button>

          <div className="mt-4 text-center text-sm opacity-60">
            Angemeldet als <strong>{nickname}</strong>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'in-progress') {
    const question = questions[currentIndex];
    if (!question) {
      return (
        <div className="min-h-screen bg-cb-dark flex items-center justify-center text-white p-8">
          Frage {currentIndex + 1} nicht gefunden. Bitte die Seite neu laden.
        </div>
      );
    }

    const progress = ((currentIndex + 1) / totalQuestions) * 100;
    const isLast = currentIndex === totalQuestions - 1;

    return (
      <div className="min-h-screen bg-cb-dark flex flex-col">
        {/* Sticky top bar */}
        <div className="bg-cb-primary/80 backdrop-blur sticky top-0 z-10 px-4 py-3 flex items-center justify-between gap-4 shadow-lg border-b border-white/10">
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-bold">
              Frage {currentIndex + 1} / {totalQuestions}
            </div>
            <div className="w-full bg-white/10 rounded-full h-2 mt-1">
              <div
                className="bg-cb-accent h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className={`text-2xl font-mono font-bold ${examTimerColor(remaining)}`}>
            {formatExamTime(remaining)}
          </div>

          <button
            onClick={() => setShowSubmitConfirm(true)}
            className="bg-red-600 hover:bg-red-500 text-white px-3 py-2 rounded text-sm font-bold whitespace-nowrap"
          >
            Beenden
          </button>
        </div>

        {/* Question body */}
        <div className="flex-1 p-4 max-w-3xl mx-auto w-full">
          <div className="text-white text-lg mb-6">
            <MarkdownText>{question.question}</MarkdownText>
          </div>

          {question.type === 'single' && (
            <SingleChoice
              options={question.options}
              selected={selectedAnswers[0] || ''}
              onChange={(id) => setSelectedAnswers([id])}
              disabled={isSubmitting}
            />
          )}
          {question.type === 'multiple' && (
            <MultipleChoice
              options={question.options}
              selected={selectedAnswers}
              onChange={setSelectedAnswers}
              disabled={isSubmitting}
            />
          )}
          {question.type === 'order' && (
            <OrderQuestion
              options={question.options}
              order={selectedAnswers.length > 0 ? selectedAnswers : question.options.map(o => o.id)}
              onChange={setSelectedAnswers}
              disabled={isSubmitting}
            />
          )}

          <button
            onClick={handleSubmitAnswer}
            disabled={selectedAnswers.length === 0 || isSubmitting}
            className="mt-8 w-full bg-cb-accent hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-white text-lg font-bold py-4 rounded-lg transition-all"
          >
            {isSubmitting
              ? 'Speichern...'
              : isLast
                ? 'Prüfung beenden'
                : 'Nächste Frage'}
          </button>

          <div className="mt-3 text-center text-xs text-white/40">
            Tipp: <kbd className="px-1.5 py-0.5 bg-white/10 rounded">1</kbd>–<kbd className="px-1.5 py-0.5 bg-white/10 rounded">{Math.min(9, question.options.length)}</kbd> Antwort wählen · <kbd className="px-1.5 py-0.5 bg-white/10 rounded">Enter</kbd> bestätigen
          </div>
        </div>

        {/* Submit-early confirmation modal */}
        {showSubmitConfirm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-20">
            <div className="bg-cb-primary rounded-lg p-6 max-w-md text-white shadow-2xl">
              <h2 className="text-xl font-bold mb-3">Prüfung wirklich beenden?</h2>
              <p className="text-sm opacity-80 mb-6">
                Du bist bei Frage {currentIndex + 1} von {totalQuestions}. Die restlichen
                Fragen zählen als falsch.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSubmitConfirm(false)}
                  className="flex-1 bg-gray-600 hover:bg-gray-500 py-2 rounded font-bold"
                >
                  Weiter prüfen
                </button>
                <button
                  onClick={() => { setShowSubmitConfirm(false); handleFinalize(); }}
                  className="flex-1 bg-red-600 hover:bg-red-500 py-2 rounded font-bold"
                >
                  Beenden
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (stage === 'submitting') {
    return (
      <div className="min-h-screen bg-cb-dark flex items-center justify-center">
        <div className="text-white text-xl">Prüfung wird ausgewertet...</div>
      </div>
    );
  }

  if (stage === 'results' && results) {
    // mm:ss format so short test runs show meaningfully (e.g., 1:07 not "1 Minuten")
    const elapsedMin = Math.floor(results.elapsedSeconds / 60);
    const elapsedSec = results.elapsedSeconds % 60;
    const elapsedFormatted = `${elapsedMin}:${elapsedSec.toString().padStart(2, '0')}`;

    return (
      <div className="min-h-screen bg-cb-dark text-white p-4">
        <div className="max-w-3xl mx-auto space-y-6 pb-12">

          {/* Hero card */}
          <div className={`rounded-3xl p-8 text-center ${
            results.passed
              ? 'bg-gradient-to-br from-green-600 to-green-800'
              : 'bg-gradient-to-br from-red-700 to-red-900'
          } shadow-2xl`}>
            <div className="text-6xl font-bold mb-2">
              {results.scaled} <span className="text-2xl opacity-70">/ 1000</span>
            </div>
            <div className="text-2xl font-bold mt-4">
              {results.passed ? '✅ Bestanden' : '❌ Nicht bestanden'}
            </div>
            <div className="text-lg mt-2 opacity-90">
              {results.correctCount} von {results.totalQuestions} richtig ({results.percentage.toFixed(1)}%)
            </div>
            <div className="text-sm mt-2 opacity-70">
              Verwendete Zeit: {elapsedFormatted} Minuten · Bestehensgrenze: {results.passingScore}
            </div>
          </div>

          {/* Per-domain breakdown */}
          <div className="bg-white/10 backdrop-blur rounded-2xl border border-white/20 p-6">
            <h2 className="text-xl font-bold mb-4">Domain-Auswertung</h2>
            <div className="space-y-3">
              {results.byDomain.map(dom => {
                const pct = dom.total > 0 ? (dom.correct / dom.total) * 100 : 0;
                const colorClass =
                  pct >= 70 ? 'bg-green-500'
                  : pct >= 50 ? 'bg-orange-500'
                  : 'bg-red-500';
                return (
                  <div key={dom.id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{dom.label}</span>
                      <span className="font-mono opacity-80">
                        {dom.correct} / {dom.total} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full transition-all ${colorClass}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Question review */}
          <div className="bg-white/10 backdrop-blur rounded-2xl border border-white/20 p-6">
            <h2 className="text-xl font-bold mb-4">Review ({results.review.length})</h2>
            <div className="space-y-3">
              {results.review.map((item, idx) => (
                <ReviewCard key={item.question.id} index={idx} item={item} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={handleRestart}
              className="bg-yellow-600 hover:bg-yellow-500 text-white py-3 rounded-lg font-bold transition-all"
            >
              🔄 Erneut versuchen
            </button>
            <button
              onClick={() => (window.location.href = '/')}
              className="bg-cb-accent hover:brightness-110 py-3 rounded-lg font-bold"
            >
              Zurück zur Startseite
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function ReviewCard({ index, item }: { index: number; item: ReviewItem }) {
  // All cards start collapsed — user expands what they want to review
  const [expanded, setExpanded] = useState(false);
  const q = item.question;
  const correctSet = new Set<string>(q.correctAnswers ?? []);
  const selectedSet = new Set<string>(item.selectedAnswers);

  return (
    <div className={`border rounded-lg overflow-hidden ${
      item.correct ? 'border-green-600/40' : 'border-red-600/60'
    }`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full p-3 text-left flex items-center justify-between bg-white/5 hover:bg-white/10 transition-colors"
      >
        <span className="font-bold">
          {item.correct ? '✅' : '❌'} Frage {index + 1}
          <span className="text-xs opacity-60 ml-2 font-normal">{q.category}</span>
        </span>
        <span className="text-sm opacity-60">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="p-4 bg-black/20 space-y-3">
          <div className="text-base">
            <MarkdownText>{q.question}</MarkdownText>
          </div>

          <div className="space-y-2 text-sm">
            {q.options.map((opt) => {
              const isCorrect = correctSet.has(opt.id);
              const isSelected = selectedSet.has(opt.id);
              let cls = 'p-2 rounded border';
              if (isCorrect) cls += ' bg-green-700/30 border-green-500/60';
              else if (isSelected) cls += ' bg-red-700/30 border-red-500/60';
              else cls += ' bg-white/5 border-white/10 opacity-70';
              return (
                <div key={opt.id} className={cls}>
                  <span className="font-mono opacity-60 mr-2">{opt.id}.</span>
                  {opt.text}
                  {isCorrect && <span className="ml-2 text-green-300 text-xs">← richtig</span>}
                  {isSelected && !isCorrect && (
                    <span className="ml-2 text-red-300 text-xs">← deine Antwort</span>
                  )}
                </div>
              );
            })}
          </div>

          {q.explanation && (
            <div className="text-sm opacity-80 pt-2 border-t border-white/10">
              <strong>Erklärung:</strong>{' '}
              <MarkdownText>{q.explanation}</MarkdownText>
            </div>
          )}

          {q.references && q.references.length > 0 && (
            <div className="text-xs opacity-60">
              <strong>Quellen:</strong>
              <ul className="list-disc list-inside">
                {q.references.map((ref, i) => (
                  <li key={i}>
                    <a
                      href={ref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-cb-accent"
                    >
                      {ref}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
