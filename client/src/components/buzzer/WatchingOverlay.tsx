interface WatchingOverlayProps {
  answerer: {
    nickname: string;
    emoji: string;
  };
  timeRemaining: number;
}

export function WatchingOverlay({ answerer, timeRemaining }: WatchingOverlayProps) {
  return (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10 rounded-lg">
      <div className="bg-white rounded-xl p-6 text-center shadow-2xl max-w-sm mx-4">
        <div className="text-5xl mb-4">{answerer.emoji}</div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">
          {answerer.nickname} antwortet...
        </h3>
        <p className="text-gray-600 mb-4">
          Warte auf die Antwort
        </p>
        <div className="text-2xl font-mono font-bold text-orange-600">
          ⏱️ {timeRemaining.toFixed(1)}s
        </div>
      </div>
    </div>
  );
}
