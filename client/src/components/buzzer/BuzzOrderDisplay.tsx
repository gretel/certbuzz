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
      <div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500">
        Noch niemand hat gebuzzert...
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="bg-gray-100 px-4 py-2 font-semibold text-gray-700 text-sm">
        Buzz-Reihenfolge
      </div>
      <ul className="divide-y divide-gray-100">
        {buzzes.map((buzz, index) => {
          const isCurrentAnswerer = index === currentAnswererIndex;
          const hasAnswered = index < currentAnswererIndex;
          
          return (
            <li
              key={`${buzz.nickname}-${index}`}
              className={`px-4 py-3 flex items-center justify-between ${
                isCurrentAnswerer ? 'bg-yellow-50 border-l-4 border-yellow-400' : ''
              } ${hasAnswered ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold ${
                  index === 0 ? 'bg-yellow-400 text-yellow-900' :
                  index === 1 ? 'bg-gray-300 text-gray-700' :
                  index === 2 ? 'bg-orange-300 text-orange-900' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {buzz.position}
                </span>
                <span className="text-xl">{buzz.emoji}</span>
                <span className="font-medium text-gray-900">{buzz.nickname}</span>
                {isCurrentAnswerer && (
                  <span className="ml-2 px-2 py-0.5 bg-yellow-400 text-yellow-900 text-xs font-bold rounded">
                    ANTWORTET
                  </span>
                )}
                {hasAnswered && (
                  <span className="ml-2 text-red-500">❌</span>
                )}
              </div>
              {showTimes && (
                <span className="text-sm font-mono text-gray-500">
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
