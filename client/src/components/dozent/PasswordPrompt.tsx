import { useState } from 'react';

interface PasswordPromptProps {
  onAuthenticated: () => void;
}

export function PasswordPrompt({ onAuthenticated }: PasswordPromptProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/dozent/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (response.status === 401) {
        setError('Falsches Passwort');
        setLoading(false);
        return;
      }

      if (response.ok) {
        localStorage.setItem('dozent-password', password);
        onAuthenticated();
      } else {
        const data = await response.json();
        setError(data.error || 'Fehler bei der Authentifizierung');
        setLoading(false);
      }
    } catch (err) {
      setError('Verbindungsfehler');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cb-dark to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black text-white mb-2">
            CERTBUZZ
          </h1>
          <p className="text-cb-accent">
            Dozenten-Bereich
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-8">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">👨‍🏫</div>
            <p className="text-white/60">Bitte Passwort eingeben</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-5 py-4 bg-white/10 border-2 border-white/20 rounded-xl text-white placeholder-white/40 focus:border-cb-accent focus:outline-none text-lg text-center tracking-widest"
                placeholder="••••••••"
                required
                autoFocus
              />
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-400/30 rounded-xl text-red-300 text-sm text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-cb-primary to-cb-accent hover:from-cb-accent hover:to-cb-primary text-white font-bold py-4 px-6 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg"
            >
              {loading ? 'Laden...' : 'Anmelden'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
