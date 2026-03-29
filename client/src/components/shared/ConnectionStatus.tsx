import { useSocket, ConnectionStatus } from '../../hooks/useSocket';

export function ConnectionStatusBanner() {
  const { connectionStatus, connectionError } = useSocket();

  if (connectionStatus === 'connected') {
    return null;
  }

  const statusConfig: Record<ConnectionStatus, { bg: string; text: string; icon: string; message: string }> = {
    connecting: {
      bg: 'bg-yellow-500',
      text: 'text-yellow-900',
      icon: '🔄',
      message: 'Verbinde zum Server...',
    },
    connected: {
      bg: 'bg-green-500',
      text: 'text-green-900',
      icon: '✓',
      message: 'Verbunden',
    },
    disconnected: {
      bg: 'bg-orange-500',
      text: 'text-orange-900',
      icon: '⚠️',
      message: 'Verbindung unterbrochen. Versuche erneut...',
    },
    error: {
      bg: 'bg-red-500',
      text: 'text-white',
      icon: '❌',
      message: connectionError || 'Verbindungsfehler',
    },
  };

  const config = statusConfig[connectionStatus];

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 ${config.bg} ${config.text} px-4 py-3 shadow-lg`}>
      <div className="max-w-4xl mx-auto flex items-center justify-center gap-3">
        <span className="text-xl animate-pulse">{config.icon}</span>
        <span className="font-medium">{config.message}</span>
        {connectionStatus === 'error' && (
          <button
            onClick={() => window.location.reload()}
            className="ml-4 px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-sm font-medium transition-colors"
          >
            Seite neu laden
          </button>
        )}
      </div>
    </div>
  );
}
