interface WatchingOverlayProps {
  answerer: {
    nickname: string;
    emoji: string;
  };
  timeRemaining: number;
}

export function WatchingOverlay({ answerer, timeRemaining }: WatchingOverlayProps) {
  return (
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg">
      <div className="bg-white/10 border border-white/20 rounded-2xl p-6 text-center max-w-sm mx-4">
        <div className="text-5xl mb-4">{answerer.emoji}</div>
        <h3 className="text-xl font-bold text-white mb-2">
          {answerer.nickname} antwortet...
        </h3>
        <p className="text-white/60 mb-4">
          Warte auf die Antwort
        </p>
        <div className="text-2xl font-mono font-bold text-cb-accent">
          ⏱️ {timeRemaining.toFixed(1)}s
        </div>
      </div>
    </div>
  );
}
