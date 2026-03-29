import { ParticleEffects } from '../effects/ParticleEffects';
import { MarkdownText } from '../shared/MarkdownText';

interface LeaderboardEntry {
  nickname: string;
  emoji: string;
  score: number;
  correct_answers: number;
}

interface Answerer {
  nickname: string;
  emoji: string;
}

interface Option {
  id: string;
  text: string;
}

interface TransitionScreenProps {
  currentQuestionIndex: number;
  totalQuestions: number;
  timeRemaining: number;
  leaderboard: LeaderboardEntry[];
  lastResult?: {
    correct: boolean;
    answerer?: Answerer;
    pointsAwarded?: number;
    noBuzzes?: boolean;
    noMoreBuzzers?: boolean;
    questionText?: string;
    options?: Option[];
    correctAnswers?: string[];
    explanation?: string;
    references?: string[];
  } | null;
}

// Helper to extract domain from URL for display
function getDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

export function TransitionScreen({
  currentQuestionIndex,
  totalQuestions,
  timeRemaining,
  leaderboard,
  lastResult,
}: TransitionScreenProps) {
  const questionOptions = lastResult?.options ?? [];
  const effectType = lastResult?.correct ? 'fireworks' : 
                     lastResult?.noBuzzes ? 'none' : 
                     lastResult ? 'rain' : 'none';

  const isLastQuestion = currentQuestionIndex + 1 >= totalQuestions;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 p-4 md:p-8">
      <ParticleEffects type={effectType} duration={18000} />
      
      <div className="max-w-6xl mx-auto relative z-10">
        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Left: Result + Explanation */}
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-6">
            {/* Result Banner */}
            {lastResult && (
              <div className={`p-6 rounded-2xl text-center mb-4 ${
                lastResult.correct 
                  ? 'bg-green-500/20 border border-green-400/30' 
                  : lastResult.noBuzzes
                    ? 'bg-white/10 border border-white/20'
                    : 'bg-red-500/20 border border-red-400/30'
              }`}>
                <div className="text-6xl mb-3">
                  {lastResult.correct ? '🎉' : lastResult.noBuzzes ? '⏱️' : '😢'}
                </div>
                {lastResult.correct && lastResult.answerer && (
                  <>
                    <p className="text-xl font-bold text-green-300">
                      {lastResult.answerer.emoji} {lastResult.answerer.nickname}
                    </p>
                    <p className="text-green-400">hat richtig geantwortet!</p>
                    {lastResult.pointsAwarded && (
                      <p className="text-green-300 font-bold text-2xl mt-2">
                        +{lastResult.pointsAwarded} Punkte
                      </p>
                    )}
                  </>
                )}
                {!lastResult.correct && !lastResult.noBuzzes && !lastResult.noMoreBuzzers && (
                  <p className="text-xl font-bold text-red-300">
                    Leider falsch...
                  </p>
                )}
                {lastResult.noMoreBuzzers && !lastResult.correct && (
                  <p className="text-xl font-bold text-red-300">
                    Alle haben falsch geantwortet!
                  </p>
                )}
                {lastResult.noBuzzes && (
                  <p className="text-xl font-bold text-white/70">
                    Niemand hat gebuzzert
                  </p>
                )}
              </div>
            )}
            
            {/* Question + All Options */}
            {lastResult?.questionText && (
              <div className="bg-white/5 rounded-2xl p-4 mb-4 border border-white/10">
                <p className="font-semibold text-white mb-3">{lastResult.questionText}</p>
                <ul className="space-y-2">
                  {questionOptions.map(option => {
                    const isCorrect = lastResult.correctAnswers?.includes(option.id);
                    return (
                      <li
                        key={option.id}
                        className={`flex items-start gap-2 px-3 py-2 rounded-lg ${
                          isCorrect
                            ? 'bg-green-500/20 border border-green-400/30'
                            : 'bg-white/5 border border-white/5'
                        }`}
                      >
                        <span className={`font-bold mt-0.5 ${isCorrect ? 'text-green-400' : 'text-white/30'}`}>
                          {isCorrect ? '✓' : option.id.toUpperCase()}
                        </span>
                        <span className={isCorrect ? 'text-green-100 font-medium' : 'text-white/60'}>
                          {option.text}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            
            {/* Explanation */}
            {lastResult?.explanation && (
              <div className="bg-cb-primary/10 rounded-2xl p-4 border border-cb-accent/20">
                <p className="font-semibold text-cb-accent mb-2">Erklärung:</p>
                <MarkdownText className="text-white/80">{lastResult.explanation}</MarkdownText>
              </div>
            )}
            
            {/* References */}
            {lastResult?.references && lastResult.references.length > 0 && (
              <div className="bg-purple-500/10 rounded-2xl p-4 border border-purple-400/20 mt-4">
                <p className="font-semibold text-purple-300 mb-2">Mehr erfahren:</p>
                <ul className="space-y-2">
                  {lastResult.references.map((url, index) => (
                    <li key={index}>
                      <a 
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-300 hover:text-purple-100 hover:underline flex items-center gap-2"
                      >
                        <span>📚</span>
                        <span className="break-all text-sm">{getDomainFromUrl(url)}</span>
                        <span className="text-purple-400">↗</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right: Timer + Leaderboard */}
          <div className="space-y-6">
            {/* Timer */}
            <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-6 text-center">
              <h2 className="text-lg font-bold text-white/80 mb-2">
                {isLastQuestion ? 'Endergebnis in...' : 'Nächste Frage in...'}
              </h2>
              <div className="text-7xl font-mono font-black text-cb-accent">
                {Math.ceil(timeRemaining)}
              </div>
              <p className="text-white/50 mt-2">
                {isLastQuestion 
                  ? `Frage ${currentQuestionIndex + 1} von ${totalQuestions} (letzte)`
                  : `Frage ${currentQuestionIndex + 2} von ${totalQuestions}`
                }
              </p>
            </div>

            {/* Leaderboard */}
            <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-6">
              <h3 className="font-bold text-white mb-4 text-center">
                Aktueller Stand
              </h3>
              <div className="space-y-2">
                {leaderboard.slice(0, 8).map((player, index) => (
                  <div 
                    key={player.nickname}
                    className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-xl"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                        index === 0 ? 'bg-yellow-400 text-yellow-900' :
                        index === 1 ? 'bg-gray-300 text-gray-700' :
                        index === 2 ? 'bg-orange-400 text-orange-900' :
                        'bg-white/10 text-white/60'
                      }`}>
                        {index + 1}
                      </span>
                      <span className="text-xl">{player.emoji}</span>
                      <span className="font-medium text-white">{player.nickname}</span>
                    </div>
                    <span className="font-bold text-cb-accent text-lg">{player.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
