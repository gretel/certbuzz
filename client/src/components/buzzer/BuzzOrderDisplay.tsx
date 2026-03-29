interface BuzzEntry {
  position: number;
  nickname: string;
  emoji: string;
  buzzTime: number; // ms
}

interface BuzzOrderDisplayProps {
  buzzes: BuzzEntry[];
  currentAnswererIndex: number;
  myPlayerId?: string | null;
  showTimes?: boolean;
}

export function BuzzOrderDisplay({ buzzes, currentAnswererIndex, showTimes = true }: BuzzOrderDisplayProps) {
  if (buzzes.length === 0) {
    return (
      <div className="bg-white/5 rounded-lg p-4 text-center text-white/50">
        Noch niemand hat gebuzzert...
      </div>
    );
  }

  return (
    <div className="bg-white/10 rounded-xl border border-white/10 overflow-hidden">
      <div className="bg-white/5 px-4 py-2 font-semibold text-white/70 text-sm">
        Buzz-Reihenfolge
      </div>
      <ul className="divide-y divide-white/5">
        {buzzes.map((buzz, index) => {
          const isCurrentAnswerer = index === currentAnswererIndex;
          const hasAnswered = index < currentAnswererIndex;

          return (
            <li
              key={`${buzz.nickname}-${index}`}
              className={`px-4 py-3 flex items-center justify-between ${
                isCurrentAnswerer ? 'bg-yellow-500/10 border-l-4 border-yellow-400' : ''
              } ${hasAnswered ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold ${
                  index === 0 ? 'bg-yellow-400 text-yellow-900' :
                  index === 1 ? 'bg-gray-300 text-gray-700' :
                  index === 2 ? 'bg-orange-300 text-orange-900' :
                  'bg-white/10 text-white/60'
                }`}>
                  {buzz.position}
                </span>
                <span className="text-xl">{buzz.emoji}</span>
                <span className="font-medium text-white">{buzz.nickname}</span>
                {isCurrentAnswerer && (
                  <span className="ml-2 px-2 py-0.5 bg-yellow-400 text-yellow-900 text-xs font-bold rounded">
                    ANTWORTET
                  </span>
                )}
                {hasAnswered && (
                  <span className="ml-2 text-red-400">❌</span>
                )}
              </div>
              {showTimes && (
                <span className="text-sm font-mono text-white/50">
                  {(buzz.buzzTime / 1000).toFixed(2)}s
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
